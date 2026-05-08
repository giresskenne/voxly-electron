import { ipcMain, shell, systemPreferences } from "electron";
import type { AppSettings, RuntimeStatus } from "./types";
import { settingsStore } from "./services/settings-store";
import { transcriptionDatabase } from "./services/database";
import { whisperService } from "./services/whisper";
import { groqTranscriptionService } from "./services/groq";
import { openAiCleanupService } from "./services/openai-cleanup";
import { pasteText } from "./services/paste";
import { windows } from "./window-manager";
import { registerDictationHotkey } from "./services/hotkeys";
import { createMainLogger } from "./debug-log";
import type { AudioChunk } from "./types";

let hotkeyRegistered = false;
const log = createMainLogger("ipc");

export function registerIpc(): void {
  log.info("Registering IPC handlers");

  ipcMain.handle("settings:get", () => {
    log.debug("IPC settings:get");
    return settingsStore.get();
  });

  ipcMain.handle("settings:update", async (_, patch: Partial<AppSettings>) => {
    log.debug("IPC settings:update", patch);
    const settings = await settingsStore.save(patch);
    if (shouldRefreshWhisper(patch)) {
      await whisperService.prewarm(settings);
    }
    hotkeyRegistered = registerDictationHotkey(settings.hotkey, () => windows.sendDictationToggle());
    windows.sendRuntimeStatus(getRuntimeStatus());
    log.info("Settings updated via IPC", { hotkeyRegistered });
    return settings;
  });

  ipcMain.handle("history:list", (_, limit?: number) => {
    log.debug("IPC history:list", { limit });
    return transcriptionDatabase.list(limit);
  });

  ipcMain.handle("transcription:save", (_, record) => {
    log.debug("IPC transcription:save", record);
    return transcriptionDatabase.save(record);
  });

  ipcMain.handle("transcribe:local-whisper", async (_, buffer: ArrayBuffer, options?: Partial<AppSettings>, chunks?: AudioChunk[]) => {
    log.info("IPC transcribe:local-whisper", { byteLength: buffer.byteLength, chunkCount: chunks?.length ?? 0, options });
    const settings = { ...settingsStore.get(), ...options };
    const originalText = await transcribeAudio(buffer, settings, chunks ?? []);
    const cleanup = settings.cleanupEnabled
      ? await openAiCleanupService.process(originalText, settings)
      : { text: originalText, method: "none" as const };
    const processedText = cleanup.text;
    log.debug("Transcription post-processing complete", {
      transcriptionMode: settings.transcriptionMode,
      cleanupEnabled: settings.cleanupEnabled,
      processingMethod: cleanup.method,
      originalText,
      processedText,
    });
    const row = await transcriptionDatabase.save({
      originalText,
      processedText,
      isProcessed: settings.cleanupEnabled,
      processingMethod: cleanup.method,
      agentName: settings.cleanupEnabled ? settings.agentName : null,
      error: null,
    });

    return { text: processedText, originalText, record: row };
  });

  ipcMain.handle("paste:text", (_, text: string) => {
    log.info("IPC paste:text", { text });
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

  ipcMain.handle("runtime:status", () => {
    const status = getRuntimeStatus();
    log.debug("IPC runtime:status", status);
    return status;
  });
}

export function registerInitialHotkey(): void {
  log.debug("Registering initial hotkey");
  hotkeyRegistered = registerDictationHotkey(settingsStore.get().hotkey, () => windows.sendDictationToggle());
  log.info("Initial hotkey registered", { hotkeyRegistered });
}

export function getRuntimeStatus(): RuntimeStatus {
  const status = {
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
    return "Voxly captured this dictation and is ready to paste it anywhere you are working.";
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

function getMicrophoneStatus(): RuntimeStatus["microphone"] {
  if (process.platform !== "darwin") return "unknown";
  return systemPreferences.getMediaAccessStatus("microphone");
}

function getAccessibilityStatus(): RuntimeStatus["accessibility"] {
  if (process.platform !== "darwin") return "unknown";
  return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied";
}
