import { clipboard, nativeImage } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("paste");

export async function pasteText(text: string): Promise<{ ok: boolean; fallback: boolean; message?: string }> {
  log.info("Paste requested", { textLength: text.length });
  const previousText = clipboard.readText();
  const previousImage = clipboard.readImage();
  log.debug("Captured previous clipboard", { previousTextLength: previousText.length, hadImage: !previousImage.isEmpty() });
  clipboard.writeText(text);

  const result = await invokeNativePaste();
  log.info("Native paste result", result);
  setTimeout(() => {
    if (!previousImage.isEmpty()) {
      clipboard.writeImage(previousImage);
      log.debug("Restored previous clipboard image");
      return;
    }
    clipboard.writeText(previousText);
    log.debug("Restored previous clipboard text", { previousTextLength: previousText.length });
  }, 650);

  return result;
}

async function invokeNativePaste(): Promise<{ ok: boolean; fallback: boolean; message?: string }> {
  const binary = resolvePasteBinary();
  log.debug("Resolved paste binary", { binary });
  if (!binary) {
    log.warn("No native paste binary for this platform; falling back to clipboard-only paste");
    return {
      ok: true,
      fallback: true,
      message: "Text copied. Press the platform paste shortcut to insert it.",
    };
  }

  return new Promise((resolve) => {
    execFile(binary, (error) => {
      if (error) {
        log.error("Native paste binary failed", error);
        resolve({
          ok: false,
          fallback: true,
          message: "Native paste failed. Text is on the clipboard.",
        });
        return;
      }
      log.debug("Native paste binary completed");
      resolve({ ok: true, fallback: false });
    });
  });
}

function resolvePasteBinary(): string | null {
  const byPlatform: Partial<Record<NodeJS.Platform, string>> = {
    darwin: "macos-fast-paste",
    win32: "windows-fast-paste.exe",
    linux: "linux-fast-paste",
  };
  const name = byPlatform[process.platform];
  if (!name) return null;
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "bin", name)
    : path.join(app.getAppPath(), "resources", "bin", name);
  log.debug("Paste binary candidate", { platform: process.platform, candidate });
  return candidate;
}

void nativeImage;
