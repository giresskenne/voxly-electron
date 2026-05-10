import { app, clipboard, systemPreferences, type NativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, chmodSync, constants, statSync } from "node:fs";
import path from "node:path";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("paste");

const PASTE_DELAYS = {
  darwin: 120,
  win32: 10,
  linux: 50,
};

const RESTORE_DELAYS = {
  darwin: 450,
  win32: 80,
  linux: 200,
};

type PasteResult = { ok: boolean; fallback: boolean; message?: string };

type ClipboardSnapshot =
  | { type: "image"; data: NativeImage }
  | { type: "html"; text: string; html: string }
  | { type: "text"; data: string };

export async function pasteText(text: string): Promise<PasteResult> {
  log.info("Paste requested", { textLength: text.length });
  const previousClipboard = saveClipboard();
  log.debug("Captured previous clipboard", clipboardSnapshotMeta(previousClipboard));
  clipboard.writeText(text);

  try {
    const result = await invokeNativePaste();
    log.info("Native paste result", result);
    if (result.ok) {
      setTimeout(() => restoreClipboard(previousClipboard), restoreDelay());
    }
    return result;
  } catch (error) {
    log.error("Native paste failed", error);
    return {
      ok: false,
      fallback: true,
      message: error instanceof Error ? error.message : "Native paste failed. Text is on the clipboard.",
    };
  }
}

async function invokeNativePaste(): Promise<PasteResult> {
  const binary = resolvePasteBinary();
  log.debug("Resolved paste binary", { binary });

  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted) {
      log.warn("Paste requested without Accessibility trust");
      return {
        ok: false,
        fallback: true,
        message: accessibilityRequiredMessage(),
      };
    }
  }

  if (!binary) {
    log.warn("No native paste binary for this platform; trying fallbacks");
    if (process.platform === "darwin") {
      await pasteMacOsWithOsascript();
      return { ok: true, fallback: true };
    }
    if (process.platform === "win32") {
      return pasteWindowsWithNircmdOrPowerShell();
    }
    return {
      ok: true,
      fallback: true,
      message: "Text copied. Press the platform paste shortcut to insert it.",
    };
  }

  try {
    await runPasteBinary(binary);
    log.debug("Native paste binary completed");
    return { ok: true, fallback: false };
  } catch (error) {
    if (process.platform === "darwin") {
      log.warn("Paste binary failed; falling back to osascript", error);
      await pasteMacOsWithOsascript();
      return { ok: true, fallback: true };
    }
    if (process.platform === "win32") {
      log.warn("Windows fast-paste binary failed; falling back to nircmd/PowerShell", error);
      return pasteWindowsWithNircmdOrPowerShell();
    }
    throw error;
  }
}

function resolvePasteBinary(): string | null {
  const byPlatform: Partial<Record<NodeJS.Platform, string>> = {
    darwin: "macos-fast-paste",
    win32: "windows-fast-paste.exe",
    linux: "linux-fast-paste",
  };
  const name = byPlatform[process.platform];
  if (!name) return null;

  // In packaged builds, binaries land in Resources/bin/ via extraResources.
  // Never use app.getAppPath() here in packaged mode — it resolves to app.asar
  // which Electron's fs shim makes look real, but spawn() cannot execute ASAR
  // paths and throws ENOTDIR.
  const candidates: string[] = app.isPackaged
    ? [
        path.join(process.resourcesPath, "bin", name),                                     // extraResources → Resources/bin/
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", name),   // asarUnpack fallback
      ]
    : [
        path.join(app.getAppPath(), "resources", "bin", name),
        path.join(__dirname, "../../../resources/bin", name),
        path.join(__dirname, "../../../resources", name),
      ];

  for (const candidate of candidates) {
    log.debug("Paste binary candidate", { platform: process.platform, candidate });
    try {
      const stats = statSync(candidate);
      if (!stats.isFile()) continue;
      try {
        accessSync(candidate, constants.X_OK);
      } catch {
        chmodSync(candidate, 0o755);
      }
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function resolveNircmdBinary(): string | null {
  if (process.platform !== "win32") return null;
  const candidates = new Set<string>([
    path.join(app.getAppPath(), "resources", "bin", "nircmd.exe"),
    path.join(__dirname, "../../../resources/bin", "nircmd.exe"),
  ]);
  if (process.resourcesPath) {
    candidates.add(path.join(process.resourcesPath, "bin", "nircmd.exe"));
    candidates.add(path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", "nircmd.exe"));
  }
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        log.debug("Resolved nircmd.exe", { candidate });
        return candidate;
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function pasteWindowsWithNircmdOrPowerShell(): Promise<PasteResult> {
  const nircmd = resolveNircmdBinary();
  if (nircmd) {
    log.debug("Trying nircmd.exe paste");
    try {
      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          const child = spawn(nircmd, ["sendkeypress", "ctrl+v"], { windowsHide: true });
          waitForPasteProcess(child, 2000).then(resolve).catch(reject);
        }, PASTE_DELAYS.win32);
      });
      return { ok: true, fallback: true };
    } catch (error) {
      log.warn("nircmd.exe paste failed; falling back to PowerShell", error);
    }
  }
  log.debug("Trying PowerShell paste");
  await new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.SendKeys]::SendWait('^v')",
      ], { windowsHide: true });
      waitForPasteProcess(child, 5000).then(resolve).catch(reject);
    }, PASTE_DELAYS.win32);
  });
  return { ok: true, fallback: true };
}

function runPasteBinary(binary: string): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const child = spawn(binary, [], { stdio: ["ignore", "pipe", "pipe"] });
      waitForPasteProcess(child, 3000).then(resolve).catch(reject);
    }, pasteDelay());
  });
}

function pasteMacOsWithOsascript(): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const child = spawn("osascript", [
        "-e",
        'tell application "System Events" to key code 9 using command down',
      ]);
      waitForPasteProcess(child, 3000).then(resolve).catch(reject);
    }, PASTE_DELAYS.darwin);
  });
}

function waitForPasteProcess(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      child.removeAllListeners();
      reject(new Error("Paste operation timed out. Text is on the clipboard."));
    }, timeoutMs);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("close", (code) => {
      if (timedOut) return;
      clearTimeout(timeout);
      child.removeAllListeners();
      if (code === 0) {
        resolve();
        return;
      }
      if (code === 2 && process.platform === "darwin") {
        reject(new Error(accessibilityRequiredMessage()));
        return;
      }
      reject(new Error(`Paste failed${code === null ? "" : ` with code ${code}`}${stderr ? `: ${stderr.trim()}` : ""}. Text is on the clipboard.`));
    });

    child.on("error", (error) => {
      if (timedOut) return;
      clearTimeout(timeout);
      child.removeAllListeners();
      reject(new Error(`Paste command failed: ${error.message}. Text is on the clipboard.`));
    });
  });
}

function saveClipboard(): ClipboardSnapshot {
  const formats = clipboard.availableFormats();
  if (formats.some((format) => format.startsWith("image/"))) {
    return { type: "image", data: clipboard.readImage() };
  }
  if (formats.includes("text/html")) {
    return { type: "html", text: clipboard.readText(), html: clipboard.readHTML() };
  }
  return { type: "text", data: clipboard.readText() };
}

function restoreClipboard(snapshot: ClipboardSnapshot): void {
  if (snapshot.type === "image") {
    if (!snapshot.data.isEmpty()) clipboard.writeImage(snapshot.data);
    log.debug("Restored previous clipboard image");
    return;
  }
  if (snapshot.type === "html") {
    clipboard.write({ text: snapshot.text, html: snapshot.html });
    log.debug("Restored previous clipboard HTML", { previousTextLength: snapshot.text.length });
    return;
  }
  clipboard.writeText(snapshot.data);
  log.debug("Restored previous clipboard text", { previousTextLength: snapshot.data.length });
}

function clipboardSnapshotMeta(snapshot: ClipboardSnapshot): Record<string, unknown> {
  if (snapshot.type === "image") {
    return { type: snapshot.type, hadImage: !snapshot.data.isEmpty() };
  }
  if (snapshot.type === "html") {
    return { type: snapshot.type, previousTextLength: snapshot.text.length, previousHtmlLength: snapshot.html.length };
  }
  return { type: snapshot.type, previousTextLength: snapshot.data.length };
}

function pasteDelay(): number {
  if (process.platform === "darwin") return PASTE_DELAYS.darwin;
  if (process.platform === "win32") return PASTE_DELAYS.win32;
  return PASTE_DELAYS.linux;
}

function restoreDelay(): number {
  if (process.platform === "darwin") return RESTORE_DELAYS.darwin;
  if (process.platform === "win32") return RESTORE_DELAYS.win32;
  return RESTORE_DELAYS.linux;
}

function accessibilityRequiredMessage(): string {
  if (process.platform === "darwin" && isLikelyRunningFromDiskImage()) {
    return "Text copied to the clipboard, but Dicta Fun is running from a disk image. Move Dicta Fun to /Applications, quit this copy, launch it from /Applications, then toggle Accessibility off and on for Dicta Fun.";
  }
  return "Text copied to the clipboard, but Accessibility permission is required to paste at the cursor. Allow Dicta Fun in System Settings -> Privacy & Security -> Accessibility, then try again.";
}

function isLikelyRunningFromDiskImage(): boolean {
  const executablePath = process.execPath;
  return executablePath.includes("/AppTranslocation/") || executablePath.startsWith("/Volumes/");
}
