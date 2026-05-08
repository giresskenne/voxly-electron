export type DictationState = "idle" | "recording" | "processing" | "complete" | "error";

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
  platform: NodeJS.Platform;
  microphone: "unknown" | "granted" | "denied" | "restricted" | "not-determined";
  accessibility: "unknown" | "granted" | "denied";
  whisper: "disabled" | "mock" | "starting" | "ready" | "missing" | "error";
  hotkeyRegistered: boolean;
};
