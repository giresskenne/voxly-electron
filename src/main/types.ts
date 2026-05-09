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
  selectedModel: string;
  language: string;
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
  microphone: "unknown" | "granted" | "denied" | "restricted" | "not-determined";
  accessibility: "unknown" | "granted" | "denied";
  whisper: "disabled" | "mock" | "starting" | "ready" | "missing" | "error";
  hotkeyRegistered: boolean;
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
