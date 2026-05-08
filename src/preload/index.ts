import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, AudioChunk, RuntimeStatus, TranscriptionRecord } from "../main/types";
import { createPreloadLogger } from "./debug-log";

const log = createPreloadLogger("preload");

type TranscribeResult = {
  text: string;
  originalText: string;
  record: TranscriptionRecord;
};

const api = {
  getSettings: () => invoke<AppSettings>("settings:get"),
  updateSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>("settings:update", patch),
  listHistory: (limit?: number) => invoke<TranscriptionRecord[]>("history:list", limit),
  transcribeLocalWhisper: (buffer: ArrayBuffer, options?: Partial<AppSettings>, chunks?: AudioChunk[]) =>
    invoke<TranscribeResult>("transcribe:local-whisper", buffer, options, chunks),
  pasteText: (text: string) =>
    invoke<{ ok: boolean; fallback: boolean; message?: string }>("paste:text", text),
  setOverlayInteractive: (interactive: boolean) => invoke<void>("overlay:set-interactive", interactive),
  openPanel: () => invoke<void>("panel:open"),
  openPermissionSettings: (kind: "microphone" | "accessibility" | "sound-input") =>
    invoke<void>("permissions:open", kind),
  getRuntimeStatus: () => invoke<RuntimeStatus>("runtime:status"),
  onDictationToggle: (callback: () => void) => {
    const listener = () => callback();
    log.debug("Subscribing to dictation:toggle");
    ipcRenderer.on("dictation:toggle", listener);
    return () => {
      log.debug("Unsubscribing from dictation:toggle");
      ipcRenderer.removeListener("dictation:toggle", listener);
    };
  },
  onRuntimeStatus: (callback: (status: RuntimeStatus) => void) => {
    const listener = (_: Electron.IpcRendererEvent, status: RuntimeStatus) => {
      log.debug("Received runtime:status", status);
      callback(status);
    };
    log.debug("Subscribing to runtime:status");
    ipcRenderer.on("runtime:status", listener);
    return () => {
      log.debug("Unsubscribing from runtime:status");
      ipcRenderer.removeListener("runtime:status", listener);
    };
  },
};

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  log.debug("Invoking IPC", { channel, args });
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

log.info("Exposing Electron API");
contextBridge.exposeInMainWorld("electronAPI", api);

export type ElectronAPI = typeof api;
