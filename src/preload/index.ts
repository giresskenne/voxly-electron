import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  AudioChunk,
  BillingInterval,
  CheckoutSession,
  DesktopUpdateStatus,
  EntitlementStatus,
  LangMismatch,
  PasteResult,
  PaidPlan,
  ReferralStatus,
  RuntimeStatus,
  TranscriptionRecord,
  WeeklyUsageStatus,
} from "../main/types";
import { createPreloadLogger } from "./debug-log";

const log = createPreloadLogger("preload");

type TranscribeResult = {
  text: string;
  originalText: string;
  record: TranscriptionRecord | null;
  langMismatch: LangMismatch | null;
};
type TranscribeOptions = Partial<AppSettings> & {
  saveToHistory?: boolean;
};

const api = {
  getSettings: () => invoke<AppSettings>("settings:get"),
  updateSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>("settings:update", patch),
  listHistory: (limit?: number) => invoke<TranscriptionRecord[]>("history:list", limit),
  getWordCountThisWeek: () => invoke<WeeklyUsageStatus>("history:word-count-this-week"),
  transcribeLocalWhisper: (buffer: ArrayBuffer, options?: TranscribeOptions, chunks?: AudioChunk[]) =>
    invoke<TranscribeResult>("transcribe:local-whisper", buffer, options, chunks),
  pasteText: (text: string) => invoke<PasteResult>("paste:text", text),
  replaceLastPastedText: (previousText: string, nextText: string) =>
    invoke<PasteResult>("paste:replace-last", previousText, nextText),
  translateText: (text: string, targetLang: string) =>
    invoke<{ text: string }>("translate:text", text, targetLang),
  setOverlayInteractive: (interactive: boolean) => invoke<void>("overlay:set-interactive", interactive),
  hideOverlayForHour: () => invoke<void>("overlay:hide-for-hour"),
  startWindowDrag: () => invoke<void>("window:start-drag"),
  stopWindowDrag: () => invoke<void>("window:stop-drag"),
  openPanel: () => invoke<void>("panel:open"),
  openPanelTab: (tab: string) => invoke<void>("panel:open-tab", tab),
  openPermissionSettings: (kind: "microphone" | "accessibility" | "sound-input") =>
    invoke<void>("permissions:open", kind),
  openWebRoute: (route: "pricing" | "signup" | "signin" | "privacy" | "terms" | "help" | "feedback" | "referral") =>
    invoke<void>("app:open-web-route", route),
  openURL: (url: string) => invoke<void>("app:open-url", url),
  consumePendingDeepLinks: () => invoke<string[]>("app:consume-pending-deep-links"),
  openApplicationsFolder: () => invoke<void>("app:open-applications-folder"),
  getAppVersion: () => invoke<string>("app:version"),
  checkForUpdates: (force?: boolean) => invoke<DesktopUpdateStatus>("app:update-check", force),
  openUpdateDownload: () => invoke<void>("app:update-open"),
  setSessionToken: (token: string, refreshToken?: string) => invoke<EntitlementStatus>("auth:set-session-token", token, refreshToken),
  clearSessionToken: () => invoke<EntitlementStatus>("auth:clear-session-token"),
  hasSessionToken: () => invoke<boolean>("auth:has-session-token"),
  getEntitlementStatus: (force?: boolean) => invoke<EntitlementStatus>("entitlement:get", force),
  syncEntitlement: (force?: boolean) =>
    invoke<{ entitlements: EntitlementStatus; settings: AppSettings }>("entitlement:sync", force),
  startCheckout: (payload: { plan: PaidPlan; interval: BillingInterval }) =>
    invoke<CheckoutSession>("billing:start-checkout", payload),
  getReferralLink: () => invoke<string>("referral:get-link"),
  getReferralStatus: () => invoke<ReferralStatus>("referral:get-status"),
  sendReferralInvite: (email: string) => invoke<void>("referral:send-invite", email),
  applyReferralCode: (code: string) => invoke<void>("referral:apply-code", code),
  sendFeedback: (message: string) => invoke<void>("app:send-feedback", message),
  getRuntimeStatus: () => invoke<RuntimeStatus>("runtime:status"),
  setHotkeyTestCaptureActive: (active: boolean) => invoke<void>("onboarding:hotkey-test-capture", active),
  log: (entry: { level: string; message: string; meta?: unknown; scope?: string; source?: string }) =>
    invoke<void>("log:write", entry),
  getLogLevel: () => invoke<string>("log:get-level"),
  onDictationToggle: (callback: () => void) => {
    const listener = () => callback();
    log.debug("Subscribing to dictation:toggle");
    ipcRenderer.on("dictation:toggle", listener);
    return () => {
      log.debug("Unsubscribing from dictation:toggle");
      ipcRenderer.removeListener("dictation:toggle", listener);
    };
  },
  onDictationStart: (callback: () => void) => {
    const listener = () => callback();
    log.debug("Subscribing to dictation:start");
    ipcRenderer.on("dictation:start", listener);
    return () => {
      log.debug("Unsubscribing from dictation:start");
      ipcRenderer.removeListener("dictation:start", listener);
    };
  },
  onDictationStop: (callback: () => void) => {
    const listener = () => callback();
    log.debug("Subscribing to dictation:stop");
    ipcRenderer.on("dictation:stop", listener);
    return () => {
      log.debug("Unsubscribing from dictation:stop");
      ipcRenderer.removeListener("dictation:stop", listener);
    };
  },
  onSettingsUpdated: (callback: (settings: AppSettings) => void) => {
    const listener = (_: Electron.IpcRendererEvent, settings: AppSettings) => {
      log.debug("Received settings:updated", settings);
      callback(settings);
    };
    log.debug("Subscribing to settings:updated");
    ipcRenderer.on("settings:updated", listener);
    return () => {
      log.debug("Unsubscribing from settings:updated");
      ipcRenderer.removeListener("settings:updated", listener);
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
  onTranscriptionSaved: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("transcription:saved", listener);
    return () => ipcRenderer.removeListener("transcription:saved", listener);
  },
  onDeepLink: (callback: (url: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on("app:deep-link", listener);
    return () => ipcRenderer.removeListener("app:deep-link", listener);
  },
  onSessionExpired: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("auth:session-expired", listener);
    return () => ipcRenderer.removeListener("auth:session-expired", listener);
  },
  onSettingsNavigateTab: (callback: (tab: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, tab: string) => callback(tab);
    ipcRenderer.on("settings:navigate-tab", listener);
    return () => ipcRenderer.removeListener("settings:navigate-tab", listener);
  },
};

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  log.debug("Invoking IPC", { channel, args });
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

log.info("Exposing Electron API");
contextBridge.exposeInMainWorld("electronAPI", api);

export type ElectronAPI = typeof api;
