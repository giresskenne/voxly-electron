import { app, ipcMain, shell, systemPreferences } from "electron";
import type { AppSettings, RuntimeStatus } from "./types";
import { settingsStore } from "./services/settings-store";
import { transcriptionDatabase } from "./services/database";
import { whisperService } from "./services/whisper";
import { groqTranscriptionService } from "./services/groq";
import { openAiCleanupService } from "./services/openai-cleanup";
import { pasteText } from "./services/paste";
import { windows } from "./window-manager";
import { registerDictationHotkey } from "./services/hotkeys";
import { globeKeyManager } from "./services/globe-key-manager";
import { createMainLogger, getLogLevel, logRendererEntry } from "./debug-log";
import type { AudioChunk } from "./types";
import { entitlementService } from "./services/entitlements";
import { billingService } from "./services/billing";
import { updateChecker } from "./services/update-checker";

let hotkeyRegistered = false;
const log = createMainLogger("ipc");
const PUSH_HOLD_START_DELAY_MS = 150;
const PUSH_STOP_COOLDOWN_MS = 300;
let pushKeyDownAt = 0;
let pushKeyIsRecording = false;
let pushLastStopAt = 0;

const ALLOWED_EXTERNAL_HOSTS = new Set(["dictafun.com", "www.dictafun.com"]);

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_EXTERNAL_HOSTS.has(host) || host.endsWith(".dictafun.com");
  } catch {
    return false;
  }
}

export function registerIpc(): void {
  log.info("Registering IPC handlers");

  ipcMain.handle("settings:get", () => {
    log.debug("IPC settings:get");
    return settingsStore.get();
  });

  ipcMain.handle("settings:update", async (_, patch: Partial<AppSettings>) => {
    log.debug("IPC settings:update", patch);
    const entitlements = await entitlementService.refresh();
    const gatedPatch = entitlementService.gateSettingsPatch(patch, entitlements);
    const settings = await settingsStore.save(gatedPatch);
    if (shouldRefreshWhisper(gatedPatch)) {
      await whisperService.prewarm(settings);
    }
    configureDictationHotkey(settings);
    windows.sendSettingsUpdated(settings);
    windows.sendRuntimeStatus(getRuntimeStatus());
    log.info("Settings updated via IPC", { hotkeyRegistered });
    return settings;
  });

  ipcMain.handle("auth:set-session-token", async (_, token: string) => {
    await entitlementService.setSessionToken(token);
    const entitlements = await entitlementService.refresh(true);
    await applyEntitlementGates(entitlements);
    log.info("Session token updated", {
      authenticated: entitlements.isAuthenticated,
      billingPlan: entitlements.billingPlan,
      billingStatus: entitlements.billingStatus,
    });
    return entitlements;
  });

  ipcMain.handle("auth:clear-session-token", async () => {
    await entitlementService.clearSessionToken();
    const entitlements = await entitlementService.refresh(true);
    await applyEntitlementGates(entitlements);
    log.info("Session token cleared");
    return entitlements;
  });

  ipcMain.handle("entitlement:get", async (_, force?: boolean) => {
    const entitlements = await entitlementService.refresh(Boolean(force));
    log.debug("IPC entitlement:get", {
      force: Boolean(force),
      source: entitlements.source,
      billingPlan: entitlements.billingPlan,
      billingStatus: entitlements.billingStatus,
      authenticated: entitlements.isAuthenticated,
    });
    return entitlements;
  });

  ipcMain.handle("entitlement:sync", async (_, force?: boolean) => {
    const entitlements = await entitlementService.refresh(Boolean(force));
    const settings = await applyEntitlementGates(entitlements);
    return { entitlements, settings };
  });

  ipcMain.handle("billing:start-checkout", async (_, payload: { plan: "starter" | "pro"; interval: "monthly" | "yearly" }) => {
    log.info("IPC billing:start-checkout", payload);
    return billingService.startCheckout(payload);
  });

  ipcMain.handle("window:start-drag", () => {
    log.debug("IPC window:start-drag");
    windows.startWindowDrag();
  });

  ipcMain.handle("window:stop-drag", () => {
    log.debug("IPC window:stop-drag");
    windows.stopWindowDrag();
  });

  ipcMain.handle("history:list", (_, limit?: number) => {
    log.debug("IPC history:list", { limit });
    return transcriptionDatabase.list(limit);
  });

  ipcMain.handle("history:word-count-this-week", () => {
    log.debug("IPC history:word-count-this-week");
    return transcriptionDatabase.wordCountThisWeek();
  });

  ipcMain.handle("transcription:save", (_, record) => {
    log.debug("IPC transcription:save", record);
    return transcriptionDatabase.save(record);
  });

  ipcMain.handle("transcribe:local-whisper", async (_, buffer: ArrayBuffer, options?: Partial<AppSettings>, chunks?: AudioChunk[]) => {
    const pipelineStart = Date.now();
    log.info("IPC transcribe:local-whisper — pipeline start", {
      byteLength: buffer.byteLength,
      chunkCount: chunks?.length ?? 0,
      options,
    });
    const entitlement = await entitlementService.refresh();
    const settings = entitlementService.gateSettings(
      { ...settingsStore.get(), ...options },
      entitlement,
    );

    const t0 = Date.now();
    const originalText = await transcribeAudio(buffer, settings, chunks ?? []);
    const transcribeMs = Date.now() - t0;
    log.info("Pipeline stage: transcription complete", {
      transcribeMs,
      transcriptionMode: settings.transcriptionMode,
      textLength: originalText.length,
    });

    // Nothing was said — skip cleanup, DB save, and paste.
    if (!originalText.trim()) {
      log.info("IPC transcribe:local-whisper — blank audio, aborting pipeline");
      return { text: "", originalText: "", record: null };
    }

    const t1 = Date.now();
    const cleanup = settings.cleanupEnabled
      ? await openAiCleanupService.process(originalText, settings)
      : { text: originalText, method: "none" as const };
    const cleanupMs = Date.now() - t1;
    log.info("Pipeline stage: cleanup complete", {
      cleanupMs,
      cleanupEnabled: settings.cleanupEnabled,
      processingMethod: cleanup.method,
      originalLength: originalText.length,
      processedLength: cleanup.text.length,
    });

    const t2 = Date.now();
    const row = await transcriptionDatabase.save({
      originalText,
      processedText: cleanup.text,
      isProcessed: settings.cleanupEnabled,
      processingMethod: cleanup.method,
      agentName: settings.cleanupEnabled ? settings.agentName : null,
      error: null,
    });
    const dbMs = Date.now() - t2;
    log.info("Pipeline stage: DB save complete", { dbMs, recordId: row.id });
    windows.sendTranscriptionSaved();

    log.info("IPC transcribe:local-whisper — pipeline complete", {
      totalMs: Date.now() - pipelineStart,
      transcribeMs,
      cleanupMs,
      dbMs,
    });

    return { text: cleanup.text, originalText, record: row };
  });

  ipcMain.handle("paste:text", async (_, text: string) => {
    log.info("IPC paste:text", { text });
    await windows.prepareOverlayForPaste();
    return pasteText(text);
  });

  ipcMain.handle("overlay:set-interactive", (_, interactive: boolean) => {
    log.debug("IPC overlay:set-interactive", { interactive });
    windows.setOverlayInteractive(interactive);
  });

  ipcMain.handle("panel:open", () => {
    log.debug("IPC panel:open");
    windows.createSettings();
  });

  ipcMain.handle("permissions:request-microphone", async () => {
    if (process.platform !== "darwin") {
      log.debug("IPC permissions:request-microphone — non-macOS, no native request needed");
      return { status: "unknown" };
    }
    const before = systemPreferences.getMediaAccessStatus("microphone");
    log.info("IPC permissions:request-microphone — current status before request", { before });
    const granted = await systemPreferences.askForMediaAccess("microphone");
    const after = systemPreferences.getMediaAccessStatus("microphone");
    log.info("IPC permissions:request-microphone — result", { granted, after });
    return { granted, status: after };
  });

  ipcMain.handle("permissions:open", (_, kind: "microphone" | "accessibility" | "sound-input") => {
    log.debug("IPC permissions:open", { kind });
    const urls = {
      microphone: process.platform === "win32"
        ? "ms-settings:privacy-microphone"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      "sound-input": "x-apple.systempreferences:com.apple.preference.sound?input",
    };
    return shell.openExternal(urls[kind]);
  });

  ipcMain.handle("app:open-web-route", (_, route: "pricing" | "signup" | "signin" | "privacy" | "terms") => {
    const routes = {
      pricing: "https://dictafun.com/pricing",
      signup: "https://dictafun.com/signup",
      signin: "https://dictafun.com/signin",
      privacy: "https://dictafun.com/privacy",
      terms: "https://dictafun.com/terms",
    } as const;
    const url = routes[route];
    log.debug("IPC app:open-web-route", { route, url });
    return shell.openExternal(url);
  });

  ipcMain.handle("app:open-url", (_, url: string) => {
    if (!isAllowedExternalUrl(url)) {
      log.warn("IPC app:open-url blocked", { url });
      throw new Error("Blocked external URL");
    }
    log.debug("IPC app:open-url", { url });
    return shell.openExternal(url);
  });

  ipcMain.handle("app:version", () => app.getVersion());

  ipcMain.handle("app:update-check", (_, force?: boolean) => {
    return updateChecker.check(Boolean(force));
  });

  ipcMain.handle("app:update-open", () => {
    return updateChecker.openDownload();
  });

  ipcMain.handle("runtime:status", () => {
    const status = getRuntimeStatus();
    log.debug("IPC runtime:status", status);
    return status;
  });

  ipcMain.handle("log:write", (_, entry: unknown) => {
    logRendererEntry(entry);
  });

  ipcMain.handle("log:get-level", () => {
    return getLogLevel();
  });
}

async function applyEntitlementGates(entitlements: ReturnType<typeof entitlementService.getCached>): Promise<AppSettings> {
  const current = settingsStore.get();
  const gated = entitlementService.gateSettings(current, entitlements);

  const changed =
    gated.transcriptionMode !== current.transcriptionMode ||
    gated.cleanupEnabled !== current.cleanupEnabled;

  if (!changed) {
    return current;
  }

  const patch: Partial<AppSettings> = {
    transcriptionMode: gated.transcriptionMode,
    cleanupEnabled: gated.cleanupEnabled,
  };
  const settings = await settingsStore.save(patch);
  if (shouldRefreshWhisper(patch)) {
    await whisperService.prewarm(settings);
  }
  windows.sendSettingsUpdated(settings);
  windows.sendRuntimeStatus(getRuntimeStatus());
  return settings;
}

export function registerInitialHotkey(): void {
  log.debug("Registering initial hotkey");
  const settings = settingsStore.get();
  configureDictationHotkey(settings);
  log.info("Initial hotkey registered", { hotkeyRegistered, hotkey: settings.hotkey, mode: settings.mode });
}

export function getRuntimeStatus(): RuntimeStatus {
  const status = {
    appVersion: app.getVersion(),
    platform: process.platform,
    microphone: getMicrophoneStatus(),
    accessibility: getAccessibilityStatus(),
    whisper: whisperService.getStatus(),
    hotkeyRegistered,
  };
  log.debug("Runtime status computed", status);
  return status;
}

async function transcribeAudio(buffer: ArrayBuffer, settings: AppSettings, chunks: AudioChunk[]): Promise<string> {
  if (settings.mockTranscription) {
    log.debug("Returning mock transcription", { transcriptionMode: settings.transcriptionMode });
    await new Promise((resolve) => setTimeout(resolve, 650));
    return "This is a test transcription. Your actual speech will appear here once you start recording.";
  }

  if (settings.transcriptionMode === "cloud") {
    return groqTranscriptionService.transcribe(buffer, settings, chunks);
  }

  return whisperService.transcribe(buffer, settings);
}

function shouldRefreshWhisper(patch: Partial<AppSettings>): boolean {
  return (
    "transcriptionMode" in patch ||
    "mockTranscription" in patch ||
    "selectedModel" in patch ||
    "whisperPort" in patch
  );
}

function configureDictationHotkey(settings: AppSettings): void {
  resetPushHotkeyState();
  hotkeyRegistered = registerDictationHotkey(settings.hotkey, handleHotkeyDown);
  globeKeyManager.stop();

  if (isGlobeLikeHotkey(settings.hotkey)) {
    globeKeyManager.start({
      onDown: handleHotkeyDown,
      onUp: handleHotkeyUp,
    });
  }
}

function handleHotkeyDown(): void {
  const settings = settingsStore.get();
  if (settings.mode === "push-to-talk" && isGlobeLikeHotkey(settings.hotkey)) {
    startPushHold();
    return;
  }

  if (settings.mode === "push-to-talk") {
    log.warn("Push-to-talk release events are unavailable for this hotkey; falling back to tap behavior", {
      hotkey: settings.hotkey,
    });
  }
  windows.sendDictationToggle();
}

function handleHotkeyUp(): void {
  const settings = settingsStore.get();
  if (settings.mode !== "push-to-talk" || !isGlobeLikeHotkey(settings.hotkey)) return;

  pushKeyDownAt = 0;
  pushLastStopAt = Date.now();
  if (!pushKeyIsRecording) return;

  pushKeyIsRecording = false;
  log.debug("Stopping dictation after push-to-talk release");
  windows.sendDictationStop();
}

function startPushHold(): void {
  const now = Date.now();
  if (now - pushLastStopAt < PUSH_STOP_COOLDOWN_MS) {
    log.debug("Ignoring push-to-talk press during cooldown");
    return;
  }

  const pressStartedAt = now;
  pushKeyDownAt = pressStartedAt;
  pushKeyIsRecording = false;
  windows.showDictationPanel();

  setTimeout(() => {
    const settings = settingsStore.get();
    if (
      pushKeyDownAt === pressStartedAt &&
      !pushKeyIsRecording &&
      settings.mode === "push-to-talk" &&
      isGlobeLikeHotkey(settings.hotkey)
    ) {
      pushKeyIsRecording = true;
      log.debug("Starting dictation after push-to-talk hold threshold");
      windows.sendDictationStart();
    }
  }, PUSH_HOLD_START_DELAY_MS);
}

function resetPushHotkeyState(): void {
  pushKeyDownAt = 0;
  pushKeyIsRecording = false;
  pushLastStopAt = 0;
}

function isGlobeLikeHotkey(hotkey: string): boolean {
  return hotkey === "GLOBE" || hotkey === "Fn";
}

function getMicrophoneStatus(): RuntimeStatus["microphone"] {
  if (process.platform !== "darwin") return "unknown";
  return systemPreferences.getMediaAccessStatus("microphone");
}

function getAccessibilityStatus(): RuntimeStatus["accessibility"] {
  if (process.platform !== "darwin") return "unknown";
  return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied";
}
