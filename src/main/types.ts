export type ReferralInvite = {
  email: string;
  sentAt: string; // ISO
  status: "pending" | "signed_up" | "rewarded";
};

export type ReferralStatus = {
  referralUrl: string;
  totalInvites: number;
  rewardsEarned: number;
  invites: ReferralInvite[];
};

export type DisplayLanguage = "en" | "fr-FR";

export type DictationState = "idle" | "recording" | "processing" | "complete" | "error";

export type BillingPlan = "free" | "starter" | "pro";

export type BillingInterval = "monthly" | "yearly";

export type PaidPlan = Exclude<BillingPlan, "free">;

export type CheckoutSession = {
  transactionId: string;
  checkoutUrl: string;
  plan: PaidPlan;
  interval: BillingInterval;
  opened: boolean;
};

export type BillingStatus =
  | "unknown"
  | "active"
  | "inactive"
  | "paused"
  | "past_due"
  | "cancelled";

export type EntitlementStatus = {
  isAuthenticated: boolean;
  accountEmail: string | null;
  billingPlan: BillingPlan;
  billingStatus: BillingStatus;
  canUseCloudTranscription: boolean;
  canUseCleanup: boolean;
  checkedAt: string;
  source: "default" | "remote";
  reason?: string;
};

export type AppSettings = {
  hotkey: string;
  mode: "push-to-talk" | "tap-to-talk";
  transcriptionMode: "local" | "cloud";
  cleanupMode: "accurate" | "fast";
  selectedModel: string;
  language: string;
  displayLanguage: DisplayLanguage;
  customDictionary: string[];
  cleanupEnabled: boolean;
  agentName: string;
  groqApiKey: string;
  groqApiKeyConfigured: boolean;
  openaiApiKey: string;
  openaiApiKeyConfigured: boolean;
  openaiBaseUrl: string;
  whisperPort: number;
  mockTranscription: boolean;
  onboardingComplete: boolean;
};

export type AudioChunk = {
  buffer: ArrayBuffer;
  mimeType: string;
};

export type TranscriptionRecord = {
  id: number;
  timestamp: string;
  originalText: string;
  processedText: string | null;
  isProcessed: boolean;
  processingMethod: "none" | "cleanup" | "agent";
  agentName: string | null;
  error: string | null;
};

export type RuntimeStatus = {
  appVersion: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  microphone: "unknown" | "granted" | "denied" | "restricted" | "not-determined";
  accessibility: "unknown" | "granted" | "denied";
  whisper: "disabled" | "mock" | "starting" | "ready" | "missing" | "error";
  hotkeyRegistered: boolean;
  pasteAttention: PasteAttention | null;
};

export type PasteAttention = {
  kind: "accessibility" | "launch-from-applications";
  summary: string;
  detail: string;
  notificationBody: string;
};

export type PasteResult = {
  ok: boolean;
  fallback: boolean;
  message?: string;
  attention?: PasteAttention;
};

export type WeeklyUsageStatus = {
  wordsUsed: number;
  wordsLimit: number | null;
  wordsRemaining: number | null;
  usageRatio: number;
  isLimited: boolean;
  isApproachingLimit: boolean;
  isLimitReached: boolean;
};

export type LangMismatch = {
  /** ISO 639-1 code of the detected spoken language, e.g. "en" */
  detected: string;
  /** ISO 639-1 code of the configured transcription language, e.g. "fr" */
  configured: string;
};

export type CleanupStatus =
  | "not_requested"
  | "pending_background"
  | "completed_replaced"
  | "completed_unchanged"
  | "skipped_short_text"
  | "failed";

/** Timing breakdown returned by the main-process transcription pipeline. */
export type MainDictationTiming = {
  transcriptionMs: number;
  cleanupMs: number;
  dbSaveMs: number;
  transcriptionMode: AppSettings["transcriptionMode"];
  cleanupMode: AppSettings["cleanupMode"];
  cleanupEnabled: boolean;
  cleanupSkipped: boolean;
  cleanupStatus: CleanupStatus;
};

export type CleanupLaterResult = {
  text: string;
  originalText: string;
  record: TranscriptionRecord | null;
  timing: Pick<MainDictationTiming, "cleanupMs" | "dbSaveMs" | "cleanupMode" | "cleanupEnabled" | "cleanupSkipped" | "cleanupStatus">;
};

/**
 * Full end-to-end dictation timing logged by the renderer after a complete
 * dictation cycle.  Combines the main-process pipeline fields from
 * `MainDictationTiming` with the renderer-side prep/paste measurements.
 */
export type FullDictationTiming = MainDictationTiming & {
  /** Time between recorder start and stop. */
  recordingMs: number;
  /** Audio duration captured from recorder start to stop. */
  audioDurationMs: number;
  /** Blob assembly + optional WAV conversion (renderer, before IPC call). */
  audioPrepMs: number;
  /** Accessibility paste duration (renderer, after IPC returns). */
  pasteMs: number;
  /** Wall-clock ms from recorder.stop() to paste completion. */
  totalAfterStopMs: number;
  /** Audio payload size sent to main. */
  audioBytes: number;
  /** Perceived latency from stop to the first pasted text. */
  timeToRawPasteMs: number;
  /** Background cleanup completion time after initial paste, when fast mode is used. */
  cleanupCompletedAfterPasteMs: number | null;
  /** Wall-clock ms from stop to final cleanup/save/replace completion. */
  totalFinalizationMs: number | null;
};

export type DesktopUpdateFile = {
  os: "mac" | "windows" | string;
  name: string;
  releaseKey: string;
  latestKey: string;
  aliasKey?: string;
};

export type DesktopUpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  source: "default" | "remote";
  downloadUrl?: string;
  releaseUrl?: string;
  fileName?: string;
  reason?: string;
};
