import { Notification, app, ipcMain, shell, systemPreferences } from "electron";
import type { AppSettings, LangMismatch, PasteAttention, RuntimeStatus, ReferralStatus } from "./types";
import { detectLanguage, normalizeToIso } from "./services/lang-detect";
import { settingsStore } from "./services/settings-store";
import { transcriptionDatabase } from "./services/database";
import { whisperService } from "./services/whisper";
import { groqTranscriptionService } from "./services/groq";
import { openAiCleanupService } from "./services/openai-cleanup";
import { pasteText, replaceLastPastedText } from "./services/paste";
import { windows } from "./window-manager";
import { registerDictationHotkey } from "./services/hotkeys";
import { globeKeyManager } from "./services/globe-key-manager";
import { createMainLogger, getLogLevel, logRendererEntry } from "./debug-log";
import type { AudioChunk } from "./types";
import { entitlementService } from "./services/entitlements";
import { billingService } from "./services/billing";
import { updateChecker } from "./services/update-checker";
import { MOCK_TRANSCRIPTION_TEXT } from "./services/mock-transcription";
import { buildWeeklyUsageStatus, countWords } from "./services/usage-policy";
import { fetchBackend, getBackendSessionToken, parseBackendError, setOnSessionExpired, BackendRejectedError } from "./services/backend-api";

let hotkeyRegistered = false;
const log = createMainLogger("ipc");
const PUSH_HOLD_START_DELAY_MS = 20;
const PUSH_STOP_COOLDOWN_MS = 300;
const TAP_TOGGLE_DEBOUNCE_MS = 250;
let pushKeyDownAt = 0;
let pushKeyIsRecording = false;
let pushLastStopAt = 0;
let tapLastToggleAt = 0;
let pasteAttention: PasteAttention | null = null;
let lastPasteAttentionNotificationAt = 0;
const PASTE_ATTENTION_NOTIFICATION_COOLDOWN_MS = 10_000;
let lastUsageNotificationKind: "approaching" | "limit-reached" | null = null;
let hotkeyTestCaptureActive = false;

type TranscriptionOptions = Partial<AppSettings> & {
  saveToHistory?: boolean;
};

const ALLOWED_EXTERNAL_HOSTS = new Set(["dictafun.com", "www.dictafun.com"]);

/** Returns the web-app base URL. Uses VITE_WEB_URL in dev, falls back to https://dictafun.com. */
function resolveWebBaseUrl(): string {
  const raw = (process.env.VITE_WEB_URL ?? "").trim().replace(/\/+$/, "");
  return raw || "https://dictafun.com";
}

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === "https:" && (ALLOWED_EXTERNAL_HOSTS.has(host) || host.endsWith(".dictafun.com"))) {
      return true;
    }
    // Allow localhost URLs only in dev builds
    if (!app.isPackaged && host === "localhost") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function registerIpc(): void {
  log.info("Registering IPC handlers");

  // Wire token-refresh session-expired callback so backend-api can push sign-in prompts to the renderer
  setOnSessionExpired(() => windows.sendSessionExpired());

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

  ipcMain.handle("auth:set-session-token", async (_, token: string, refreshToken?: string) => {
    await entitlementService.setSessionToken(token, refreshToken);
    const entitlements = await entitlementService.refresh(true);
    await applyEntitlementGates(entitlements);
    log.info("Session token updated", {
      authenticated: entitlements.isAuthenticated,
      billingPlan: entitlements.billingPlan,
      billingStatus: entitlements.billingStatus,
      hasRefreshToken: Boolean(refreshToken?.trim()),
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

  ipcMain.handle("auth:has-session-token", async () => {
    const token = await getBackendSessionToken();
    return token.length > 0;
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

  ipcMain.handle("history:word-count-this-week", async () => {
    log.debug("IPC history:word-count-this-week");
    const [wordsUsed, entitlement] = await Promise.all([
      transcriptionDatabase.wordCountThisWeek(),
      entitlementService.refresh(),
    ]);
    return buildWeeklyUsageStatus(wordsUsed, entitlement);
  });

  ipcMain.handle("transcription:save", (_, record) => {
    log.debug("IPC transcription:save", record);
    return transcriptionDatabase.save(record);
  });

  ipcMain.handle("transcribe:local-whisper", async (_, buffer: ArrayBuffer, options?: TranscriptionOptions, chunks?: AudioChunk[]) => {
    const pipelineStart = Date.now();
    const saveToHistory = options?.saveToHistory !== false;
    log.info("IPC transcribe:local-whisper — pipeline start", {
      byteLength: buffer.byteLength,
      chunkCount: chunks?.length ?? 0,
      options,
      saveToHistory,
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
    log.debug("Pipeline transcript text", {
      transcribedText: originalText,
      language: settings.language,
      transcriptionMode: settings.transcriptionMode,
    });

    // Nothing was said — skip cleanup, DB save, and paste.
    if (!originalText.trim()) {
      log.info("IPC transcribe:local-whisper — blank audio, aborting pipeline");
      return { text: "", originalText: "", record: null, langMismatch: null };
    }

    // Detect language mismatch: if the user spoke a different language than configured.
    let langMismatch: LangMismatch | null = null;
    if (settings.language && settings.language !== "auto") {
      const configuredIso = normalizeToIso(settings.language);
      const detectedIso = detectLanguage(originalText);
      if (detectedIso && detectedIso !== configuredIso) {
        langMismatch = { detected: detectedIso, configured: configuredIso };
        log.info("Language mismatch detected", { detectedIso, configuredIso });
      } else {
        log.debug("Language mismatch not detected", {
          detectedIso: detectedIso ?? null,
          configuredIso,
        });
      }
    } else {
      log.debug("Language mismatch check skipped", {
        configuredLanguage: settings.language,
      });
    }

    const weeklyUsage = buildWeeklyUsageStatus(
      await transcriptionDatabase.wordCountThisWeek(),
      entitlement,
    );
    const originalWordCount = countWords(originalText);
    if (
      weeklyUsage.isLimited &&
      weeklyUsage.wordsRemaining !== null &&
      originalWordCount > weeklyUsage.wordsRemaining
    ) {
      maybeNotifyUsageLimit("limit-reached");
      log.warn("Weekly free word limit blocked transcription", {
        wordsUsed: weeklyUsage.wordsUsed,
        wordsRemaining: weeklyUsage.wordsRemaining,
        originalWordCount,
      });
      throw new Error("Weekly free word limit reached. Upgrade to keep dictating this week.");
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
    log.debug("Pipeline cleanup text", {
      recordedText: originalText,
      cleanedText: cleanup.text,
      cleanupEnabled: settings.cleanupEnabled,
      processingMethod: cleanup.method,
    });

    if (!saveToHistory) {
      log.info("IPC transcribe:local-whisper — returning without history save");
      return { text: cleanup.text, originalText, record: null, langMismatch };
    }

    const t2 = Date.now();
    const row = await transcriptionDatabase.save({
      originalText,
      processedText: cleanup.text,
      isProcessed: cleanup.method !== "none",
      processingMethod: cleanup.method,
      agentName: cleanup.method === "agent" ? settings.agentName : null,
      error: null,
    });
    const dbMs = Date.now() - t2;
    log.info("Pipeline stage: DB save complete", { dbMs, recordId: row.id });
    windows.sendTranscriptionSaved();

    const updatedUsage = buildWeeklyUsageStatus(
      await transcriptionDatabase.wordCountThisWeek(),
      entitlement,
    );
    if (updatedUsage.isLimitReached) {
      maybeNotifyUsageLimit("limit-reached");
    } else if (updatedUsage.isApproachingLimit) {
      maybeNotifyUsageLimit("approaching");
    }

    log.info("IPC transcribe:local-whisper — pipeline complete", {
      totalMs: Date.now() - pipelineStart,
      transcribeMs,
      cleanupMs,
      dbMs,
    });

    return { text: cleanup.text, originalText, record: row, langMismatch };
  });

  ipcMain.handle("paste:text", async (_, text: string) => {
    log.info("IPC paste:text", { text });
    await windows.prepareOverlayForPaste();
    const result = await pasteText(text);

    if (result.ok) {
      if (pasteAttention) {
        pasteAttention = null;
        windows.sendRuntimeStatus(getRuntimeStatus());
      }
      return result;
    }

    if (result.attention) {
      pasteAttention = result.attention;
      windows.sendRuntimeStatus(getRuntimeStatus());
      maybeNotifyPasteAttention(result.attention);
    }

    return result;
  });

  ipcMain.handle("paste:replace-last", async (_, previousText: string, nextText: string) => {
    log.info("IPC paste:replace-last", {
      previousTextLength: previousText.length,
      nextTextLength: nextText.length,
    });
    await windows.prepareOverlayForPaste();
    const result = await replaceLastPastedText(previousText, nextText);

    if (result.ok) {
      if (pasteAttention) {
        pasteAttention = null;
        windows.sendRuntimeStatus(getRuntimeStatus());
      }
      return result;
    }

    if (result.attention) {
      pasteAttention = result.attention;
      windows.sendRuntimeStatus(getRuntimeStatus());
      maybeNotifyPasteAttention(result.attention);
    }

    return result;
  });

  ipcMain.handle("translate:text", async (_, text: string, targetLang: string) => {
    log.info("IPC translate:text", { textLength: text.length, targetLang });
    const settings = settingsStore.get();
    const translated = await openAiCleanupService.translate(text, targetLang, settings);
    return { text: translated };
  });

  ipcMain.handle("overlay:set-interactive", (_, interactive: boolean) => {
    log.debug("IPC overlay:set-interactive", { interactive });
    windows.setOverlayInteractive(interactive);
  });

  ipcMain.handle("overlay:hide-for-hour", () => {
    log.debug("IPC overlay:hide-for-hour");
    windows.hideOverlayForHour();
  });

  ipcMain.handle("panel:open", () => {
    log.debug("IPC panel:open");
    windows.createSettings();
  });

  ipcMain.handle("panel:open-tab", (_, tab: string) => {
    log.debug("IPC panel:open-tab", { tab });
    windows.openSettingsTab(tab);
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
    if (process.platform === "darwin" && kind === "accessibility") {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      log.info("IPC permissions:open — requested Accessibility trust", {
        trusted,
        execPath: process.execPath,
      });
    }
    const urls = {
      microphone: process.platform === "win32"
        ? "ms-settings:privacy-microphone"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      "sound-input": "x-apple.systempreferences:com.apple.preference.sound?input",
    };
    return shell.openExternal(urls[kind]);
  });

  ipcMain.handle("referral:get-link", async () => {
    log.debug("IPC referral:get-link");
    try {
      const res = await fetchBackend("/api/referral/link");
      const body = await res.text();
      if (!res.ok) {
        throw new Error(parseBackendError(body, "Could not load your referral link."));
      }
      const json = JSON.parse(body) as { referralUrl?: string; referral_url?: string };
      const url = json.referralUrl ?? json.referral_url ?? null;
      if (!url || typeof url !== "string") throw new Error("Referral URL missing in response.");
      return url as string;
    } catch (error) {
      log.warn("referral:get-link failed", { error });
      throw error;
    }
  });

  ipcMain.handle("referral:get-status", async () => {
    log.debug("IPC referral:get-status");
    try {
      const res = await fetchBackend("/api/referral/status");
      const body = await res.text();
      if (!res.ok) {
        throw new Error(parseBackendError(body, "Could not load referral status."));
      }
      return JSON.parse(body) as ReferralStatus;
    } catch (error) {
      log.warn("referral:get-status failed", { error });
      throw error;
    }
  });

  ipcMain.handle("referral:send-invite", async (_, email: string) => {
    log.debug("IPC referral:send-invite", { email });
    const res = await fetchBackend("/api/referral/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(parseBackendError(body, "Failed to send invite."));
    }
  });

  ipcMain.handle("referral:apply-code", async (_, code: string) => {
    log.debug("IPC referral:apply-code");
    const res = await fetchBackend("/api/referral/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(parseBackendError(body, "Invalid or already-used referral code."));
    }
  });

  ipcMain.handle("app:send-feedback", async (_, message: string) => {
    log.debug("IPC app:send-feedback");
    const trimmed = (message ?? "").trim();
    if (!trimmed) throw new Error("Feedback message is empty.");
    const res = await fetchBackend("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(parseBackendError(body, "Failed to send feedback. Please try again."));
    }
  });

  ipcMain.handle("app:open-web-route", (_, route: "pricing" | "signup" | "signin" | "privacy" | "terms" | "help" | "feedback" | "referral") => {
    const base = resolveWebBaseUrl();
    const routes = {
      pricing: `${base}/pricing`,
      signup: `${base}/signup`,
      // Pass ?desktop=1 so the web app auto-redirects back via dictafun://auth?token=…
      signin: `${base}/auth?next=/app&desktop=1`,
      privacy: `${base}/privacy`,
      terms: `${base}/terms`,
      help: `${base}/help`,
      feedback: `${base}/feedback`,
      referral: `${base}/referral`,
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

  ipcMain.handle("app:open-applications-folder", () => {
    if (process.platform !== "darwin") return;
    return shell.openPath("/Applications");
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

  ipcMain.handle("onboarding:hotkey-test-capture", (_, active: boolean) => {
    hotkeyTestCaptureActive = active;
    log.debug("IPC onboarding:hotkey-test-capture", { active });
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
  pasteAttention = resolvePasteAttention(pasteAttention);
  const status = {
    appVersion: app.getVersion(),
    platform: process.platform,
    microphone: getMicrophoneStatus(),
    accessibility: getAccessibilityStatus(),
    whisper: whisperService.getStatus(),
    hotkeyRegistered,
    pasteAttention,
  };
  log.debug("Runtime status computed", status);
  return status;
}

async function transcribeAudio(buffer: ArrayBuffer, settings: AppSettings, chunks: AudioChunk[]): Promise<string> {
  if (settings.mockTranscription) {
    log.debug("Returning mock transcription", { transcriptionMode: settings.transcriptionMode });
    await new Promise((resolve) => setTimeout(resolve, 650));
    return MOCK_TRANSCRIPTION_TEXT;
  }

  // Primary: Groq cloud transcription (via backend session or direct API key).
  try {
    return await groqTranscriptionService.transcribe(buffer, settings, chunks);
  } catch (err) {
    // If the backend is reachable but explicitly rejected the request (auth, limit, etc.),
    // do NOT fall back to local Whisper — surface the error to the user.
    if (err instanceof BackendRejectedError) {
      log.warn("Backend rejected transcription — not falling back to local Whisper", { error: err.message });
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const isExpectedFallback = msg.includes("unavailable") || msg.includes("no API key");
    if (isExpectedFallback) {
      log.debug("Groq unavailable — using local Whisper", { reason: msg });
    } else {
      log.warn("Groq transcription failed — falling back to local Whisper", { error: msg });
    }
  }

  // Fallback: local Whisper server.
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

  if (isGlobeLikeHotkey(settings.hotkey)) {
    const now = Date.now();
    if (now - tapLastToggleAt < TAP_TOGGLE_DEBOUNCE_MS) {
      log.debug("Ignoring duplicate Globe/Fn tap event");
      return;
    }
    tapLastToggleAt = now;
  }

  sendDictationToggle();
}

function handleHotkeyUp(): void {
  const settings = settingsStore.get();
  if (settings.mode !== "push-to-talk" || !isGlobeLikeHotkey(settings.hotkey)) return;

  pushKeyDownAt = 0;
  pushLastStopAt = Date.now();
  if (!pushKeyIsRecording) return;

  pushKeyIsRecording = false;
  log.debug("Stopping dictation after push-to-talk release");
  sendDictationStop();
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
  if (!shouldCaptureHotkeyTest()) {
    windows.showDictationPanel();
  }

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
      sendDictationStart();
    }
  }, PUSH_HOLD_START_DELAY_MS);
}

function sendDictationToggle(): void {
  if (shouldCaptureHotkeyTest()) {
    windows.sendSettingsDictationToggle();
    return;
  }
  windows.sendDictationToggle();
}

function sendDictationStart(): void {
  if (shouldCaptureHotkeyTest()) {
    windows.sendSettingsDictationStart();
    return;
  }
  windows.sendDictationStart();
}

function sendDictationStop(): void {
  if (shouldCaptureHotkeyTest()) {
    windows.sendSettingsDictationStop();
    return;
  }
  windows.sendDictationStop();
}

function shouldCaptureHotkeyTest(): boolean {
  if (!hotkeyTestCaptureActive) return false;
  if (windows.isSettingsVisible()) return true;
  hotkeyTestCaptureActive = false;
  return false;
}

function resetPushHotkeyState(): void {
  pushKeyDownAt = 0;
  pushKeyIsRecording = false;
  pushLastStopAt = 0;
  tapLastToggleAt = 0;
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

function resolvePasteAttention(current: PasteAttention | null): PasteAttention | null {
  if (!current) return null;

  if (current.kind === "accessibility" && getAccessibilityStatus() === "granted") {
    return null;
  }

  return current;
}

function maybeNotifyPasteAttention(attention: PasteAttention): void {
  if (process.platform !== "darwin") return;
  if (windows.isSettingsVisible()) return;
  if (!Notification.isSupported()) return;

  const now = Date.now();
  if (now - lastPasteAttentionNotificationAt < PASTE_ATTENTION_NOTIFICATION_COOLDOWN_MS) {
    return;
  }
  lastPasteAttentionNotificationAt = now;

  const notification = new Notification({
    title: "Paste setup needed",
    body: attention.notificationBody,
    silent: false,
  });
  notification.on("click", () => {
    windows.createSettings();
  });
  notification.show();
}

function maybeNotifyUsageLimit(kind: "approaching" | "limit-reached"): void {
  if (!Notification.isSupported()) return;
  if (lastUsageNotificationKind === kind) return;
  lastUsageNotificationKind = kind;

  const notification = new Notification({
    title: kind === "limit-reached" ? "Free word limit reached" : "Free word limit almost reached",
    body: kind === "limit-reached"
      ? "Upgrade to keep dictating this week."
      : "You are close to your 2,000 free words this week. Upgrade for more room.",
    silent: false,
  });
  notification.on("click", () => {
    void shell.openExternal(`${resolveWebBaseUrl()}/pricing`);
  });
  notification.show();
}
