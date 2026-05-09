import type { AppSettings, TranscriptionRecord } from "../types";
import { createMainLogger } from "../debug-log";
import { credentialStore } from "./credential-store";
import { fetchBackend, getBackendSessionToken, parseBackendError, resolveBackendBaseUrl } from "./backend-api";

const log = createMainLogger("openai-cleanup");

const OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

type CleanupResult = {
  text: string;
  method: TranscriptionRecord["processingMethod"];
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

export class OpenAiCleanupService {
  async process(text: string, settings: AppSettings): Promise<CleanupResult> {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return { text: "", method: "cleanup" };

    const agentInstruction = this.extractAgentInstruction(normalized, settings.agentName);
    const method: CleanupResult["method"] = agentInstruction ? "agent" : "cleanup";

    const backendBaseUrl = resolveBackendBaseUrl();
    const backendToken = backendBaseUrl ? await getBackendSessionToken() : "";
    if (backendBaseUrl && backendToken) {
      return this.processWithBackend(normalized, settings, method, agentInstruction);
    }

    const apiKey = await this.resolveApiKey(settings);
    if (!apiKey) {
      log.warn("No backend session or OpenAI API key configured — skipping cleanup, returning raw transcription", {
        backendConfigured: Boolean(backendBaseUrl),
      });
      return { text: normalized, method: "none" as const };
    }

    const messages = agentInstruction
      ? this.agentMessages(settings.agentName, normalized, agentInstruction)
      : this.cleanupMessages(normalized);

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
        temperature: 0.2,
        messages,
      }),
    });

    const body = await response.text();
    const payload = this.parseResponse(body);

    log.debug("OpenAI cleanup response received", {
      status: response.status,
      elapsedMs: Date.now() - started,
      method,
    });

    if (!response.ok) {
      throw new Error(payload.error?.message || `OpenAI cleanup returned ${response.status}`);
    }

    const processed = payload.choices?.[0]?.message?.content?.trim();
    if (!processed) {
      throw new Error("OpenAI cleanup returned an empty response.");
    }

    log.info("OpenAI cleanup completed", { method, originalLength: normalized.length, processedLength: processed.length });
    return { text: processed, method };
  }

  private async processWithBackend(
    text: string,
    settings: AppSettings,
    method: CleanupResult["method"],
    agentInstruction: string | null,
  ): Promise<CleanupResult> {
    const started = Date.now();
    const response = await fetchBackend("/ai/cleanup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        method,
        agentName: settings.agentName,
        instruction: agentInstruction,
      }),
    });

    const body = await response.text();
    const payload = this.parseBackendCleanupResponse(body);

    log.debug("Backend cleanup response received", {
      status: response.status,
      elapsedMs: Date.now() - started,
      method,
    });

    if (!response.ok) {
      throw new Error(parseBackendError(body, `Backend cleanup returned ${response.status}`));
    }

    const processed = this.extractBackendText(payload);
    if (!processed) {
      throw new Error("Backend cleanup returned an empty response.");
    }

    const backendMethod = this.extractBackendMethod(payload.method) ?? method;
    log.info("Backend cleanup completed", { method: backendMethod, originalLength: text.length, processedLength: processed.length });
    return { text: processed, method: backendMethod };
  }

  private cleanupMessages(text: string) {
    return [
      {
        role: "system",
        content:
          "You clean up dictated text before it is pasted. Fix punctuation, capitalization, and obvious filler words. Preserve meaning and wording. Return only the cleaned text.",
      },
      {
        role: "user",
        content: text,
      },
    ];
  }

  private agentMessages(agentName: string, fullText: string, instruction: string) {
    return [
      {
        role: "system",
        content:
          "You are a voice writing assistant. The user addressed you by name and gave an instruction. Follow the instruction and return only the text that should be pasted.",
      },
      {
        role: "user",
        content: `Assistant name: ${agentName}\nInstruction: ${instruction}\nRaw dictation: ${fullText}`,
      },
    ];
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
    return settings.openaiApiKey.trim() || process.env.OPENAI_API_KEY?.trim() || (await credentialStore.get("openaiApiKey"));
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
}

export const openAiCleanupService = new OpenAiCleanupService();
