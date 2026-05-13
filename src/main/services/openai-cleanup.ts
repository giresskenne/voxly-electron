import type { AppSettings, TranscriptionRecord } from "../types";
import { createMainLogger } from "../debug-log";
import { credentialStore } from "./credential-store";
import { fetchBackend, getBackendAiCapabilities, getBackendSessionToken, parseBackendError, resolveBackendBaseUrl } from "./backend-api";
import {
  agentMessages,
  cleanupInstructionText,
  cleanupMessages,
  enforceDictationFidelity,
  normalizeDictationText,
} from "./cleanup-fidelity";

const log = createMainLogger("openai-cleanup");

const OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const SLOW_AI_REQUEST_MS = 2_000;

const LANG_NAMES: Record<string, string> = {
  fr: "French", en: "English", es: "Spanish", de: "German", pt: "Portuguese",
  it: "Italian", ja: "Japanese", zh: "Chinese", ko: "Korean", ru: "Russian", ar: "Arabic",
};

type CleanupResult = {
  text: string;
  method: TranscriptionRecord["processingMethod"];
};

type ApiKeyResolution = {
  key: string;
  source: "settings" | "env" | "credential-store" | "none";
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type BackendCleanupResponse = {
  text?: unknown;
  processedText?: unknown;
  method?: unknown;
  error?: {
    message?: unknown;
  };
};

type BackendCleanupRequest = {
  text: string;
  mode?: string;
  instructions?: string;
};

export function buildBackendCleanupRequest(
  text: string,
  mode?: string,
  instructions?: string,
): BackendCleanupRequest {
  return {
    text,
    mode,
    instructions,
  };
}

export class OpenAiCleanupService {
  async process(text: string, settings: AppSettings): Promise<CleanupResult> {
    const normalized = normalizeDictationText(text);
    if (!normalized) return { text: "", method: "cleanup" };

    const agentInstruction = this.extractAgentInstruction(normalized, settings.agentName);
    const method: CleanupResult["method"] = agentInstruction ? "agent" : "cleanup";

    const backendBaseUrl = resolveBackendBaseUrl();
    const backendToken = backendBaseUrl ? await getBackendSessionToken() : "";
    const hasBackendBaseUrl = Boolean(backendBaseUrl);
    const hasBackendToken = Boolean(backendToken);
    const directApi = await this.resolveApiKeyWithSource(settings);

    log.debug("Cleanup provider selection", {
      method,
      backendBaseUrl: backendBaseUrl || null,
      hasBackendBaseUrl,
      hasBackendToken,
      usingBackend: hasBackendBaseUrl && hasBackendToken,
      hasDirectApiKey: Boolean(directApi.key),
      directApiKeySource: directApi.source,
    });

    if (backendBaseUrl && backendToken) {
      const caps = await getBackendAiCapabilities();
      if (!caps.cleanup) {
        log.warn("Backend has no AI keys configured — skipping cleanup, returning raw transcription");
        return { text: normalized, method: "none" as const };
      }
      return this.processWithBackend(normalized, settings, method, agentInstruction);
    }

    const apiKey = directApi.key;
    if (!apiKey) {
      log.warn("No backend session or OpenAI API key configured — skipping cleanup, returning raw transcription", {
        backendConfigured: Boolean(backendBaseUrl),
      });
      return { text: normalized, method: "none" as const };
    }

    const messages = agentInstruction
      ? agentMessages(settings.agentName, normalized, agentInstruction)
      : cleanupMessages(normalized);

    const baseUrl = this.resolveBaseUrl(settings);
    const started = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages,
      }),
    });

    const body = await response.text();
    const payload = this.parseResponse(body);
    const elapsedMs = Date.now() - started;

    log.debug("OpenAI cleanup response received", {
      status: response.status,
      elapsedMs,
      method,
    });
    if (elapsedMs > SLOW_AI_REQUEST_MS) {
      log.warn("OpenAI cleanup was slow", { elapsedMs, method });
    }

    if (!response.ok) {
      throw new Error(payload.error?.message || `OpenAI cleanup returned ${response.status}`);
    }

    const processed = payload.choices?.[0]?.message?.content?.trim();
    if (!processed) {
      throw new Error("OpenAI cleanup returned an empty response.");
    }

    const guarded = this.enforceFidelity(normalized, processed, method);
    log.info("OpenAI cleanup completed", {
      method: guarded.method,
      originalLength: normalized.length,
      processedLength: guarded.text.length,
      fidelityFallback: guarded.method === "none",
    });
    return guarded;
  }

  private async processWithBackend(
    text: string,
    settings: AppSettings,
    method: CleanupResult["method"],
    agentInstruction: string | null,
  ): Promise<CleanupResult> {
    const instructions = method === "agent"
      ? agentInstruction ?? undefined
      : cleanupInstructionText();
    const started = Date.now();
    const response = await fetchBackend("/ai/cleanup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildBackendCleanupRequest(text, method, instructions)),
    });

    const body = await response.text();
    const payload = this.parseBackendCleanupResponse(body);
    const elapsedMs = Date.now() - started;

    log.debug("Backend cleanup response received", {
      status: response.status,
      elapsedMs,
      method,
    });
    if (elapsedMs > SLOW_AI_REQUEST_MS) {
      log.warn("Backend cleanup was slow", { elapsedMs, method });
    }

    if (!response.ok) {
      throw new Error(parseBackendError(body, `Backend cleanup returned ${response.status}`));
    }

    const processed = this.extractBackendText(payload);
    if (!processed) {
      throw new Error("Backend cleanup returned an empty response.");
    }

    const backendMethod = this.extractBackendMethod(payload.method) ?? method;
    const guarded = this.enforceFidelity(text, processed, backendMethod);
    log.info("Backend cleanup completed", {
      method: guarded.method,
      originalLength: text.length,
      processedLength: guarded.text.length,
      fidelityFallback: guarded.method === "none",
    });
    return guarded;
  }

  private extractAgentInstruction(text: string, agentName: string): string | null {
    const name = agentName.trim();
    if (!name) return null;

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^(?:hey\\s+|hi\\s+|okay\\s+|ok\\s+)?${escapedName}[,.:;\\s-]+(.+)$`, "i");
    const match = text.match(pattern);
    return match?.[1]?.trim() || null;
  }

  private async resolveApiKey(settings: AppSettings): Promise<string> {
    return (await this.resolveApiKeyWithSource(settings)).key;
  }

  private async resolveApiKeyWithSource(settings: AppSettings): Promise<ApiKeyResolution> {
    const fromSettings = settings.openaiApiKey.trim();
    if (fromSettings) return { key: fromSettings, source: "settings" };

    const fromEnv = process.env.OPENAI_API_KEY?.trim() ?? "";
    if (fromEnv) return { key: fromEnv, source: "env" };

    const fromStore = await credentialStore.get("openaiApiKey");
    if (fromStore.trim()) return { key: fromStore, source: "credential-store" };

    return { key: "", source: "none" };
  }

  private resolveBaseUrl(settings: AppSettings): string {
    return (settings.openaiBaseUrl.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  }

  private parseResponse(body: string): ChatCompletionResponse {
    if (!body) return {};
    try {
      return JSON.parse(body) as ChatCompletionResponse;
    } catch {
      return { error: { message: body } };
    }
  }

  private parseBackendCleanupResponse(body: string): BackendCleanupResponse {
    if (!body) return {};
    try {
      return JSON.parse(body) as BackendCleanupResponse;
    } catch {
      return { error: { message: body } };
    }
  }

  private extractBackendText(payload: BackendCleanupResponse): string {
    const text = typeof payload.text === "string" ? payload.text : payload.processedText;
    return typeof text === "string" ? text.trim() : "";
  }

  private extractBackendMethod(method: unknown): CleanupResult["method"] | null {
    if (method === "cleanup" || method === "agent" || method === "none") return method;
    return null;
  }

  private enforceFidelity(
    originalText: string,
    processedText: string,
    method: CleanupResult["method"],
  ): CleanupResult {
    if (method === "agent") {
      return { text: processedText, method };
    }

    const fidelity = enforceDictationFidelity(originalText, processedText);
    if (fidelity.reason) {
      log.warn("Cleanup output failed fidelity check; returning raw transcription", {
        reason: fidelity.reason,
        originalText,
        processedText,
      });
      return { text: fidelity.text, method: "none" };
    }

    return { text: fidelity.text, method };
  }

  async translate(text: string, targetLang: string, settings: AppSettings): Promise<string> {
    const backendBaseUrl = resolveBackendBaseUrl();
    const backendToken = backendBaseUrl ? await getBackendSessionToken() : "";

    if (backendBaseUrl && backendToken) {
      return this.translateWithBackend(text, targetLang);
    }

    const apiKey = await this.resolveApiKey(settings);
    if (!apiKey) {
      log.warn("No backend session and no OpenAI API key for translation — returning original text");
      return text;
    }

    const langName = LANG_NAMES[targetLang] ?? targetLang;
    const baseUrl = this.resolveBaseUrl(settings);
    const started = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: `Translate the following text to ${langName}. Return only the translated text, no explanations.` },
          { role: "user", content: text },
        ],
      }),
    });
    const body = await response.text();
    const payload = this.parseResponse(body);
    const elapsedMs = Date.now() - started;
    log.debug("OpenAI translation response received", { status: response.status, elapsedMs });
    if (elapsedMs > SLOW_AI_REQUEST_MS) {
      log.warn("OpenAI translation was slow", { elapsedMs, targetLang });
    }
    if (!response.ok) throw new Error(payload.error?.message ?? `Translation returned ${response.status}`);
    const translated = payload.choices?.[0]?.message?.content?.trim() ?? text;
    log.info("OpenAI translation completed", {
      targetLang,
      originalLength: text.length,
      translatedLength: translated.length,
      changed: normalizeComparableText(translated) !== normalizeComparableText(text),
    });
    return translated;
  }

  private async translateWithBackend(text: string, targetLang: string): Promise<string> {
    const langName = LANG_NAMES[targetLang] ?? targetLang;
    const started = Date.now();
    const response = await fetchBackend("/ai/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildBackendCleanupRequest(
          text,
          "translation",
          `Translate to ${langName}. Return only the translated text, no explanations.`,
        ),
      ),
    });
    const body = await response.text();
    const payload = this.parseBackendCleanupResponse(body);
    const elapsedMs = Date.now() - started;
    log.debug("Backend translation response received", { status: response.status, elapsedMs });
    if (elapsedMs > SLOW_AI_REQUEST_MS) {
      log.warn("Backend translation was slow", { elapsedMs, targetLang });
    }
    if (!response.ok) {
      throw new Error(parseBackendError(body, `Backend translation returned ${response.status}`));
    }
    const translated = this.extractBackendText(payload);
    if (!translated) throw new Error("Backend translation returned an empty response.");
    log.info("Backend translation completed", {
      targetLang,
      originalLength: text.length,
      translatedLength: translated.length,
      changed: normalizeComparableText(translated) !== normalizeComparableText(text),
    });
    return translated;
  }
}

function normalizeComparableText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export const openAiCleanupService = new OpenAiCleanupService();
