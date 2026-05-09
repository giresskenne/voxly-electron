import type { AppSettings, AudioChunk } from "../types";
import { createMainLogger } from "../debug-log";
import { credentialStore } from "./credential-store";
import { fetchBackend, getBackendSessionToken, parseBackendError, resolveBackendBaseUrl } from "./backend-api";

const log = createMainLogger("groq");

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const LARGE_AUDIO_THRESHOLD_BYTES = 4 * 1024 * 1024;

type GroqTranscriptionResponse = {
  text?: string;
  error?: {
    message?: string;
  };
};

export class GroqTranscriptionService {
  async transcribe(buffer: ArrayBuffer, settings: AppSettings, chunks: AudioChunk[] = []): Promise<string> {
    const segments = this.resolveSegments(buffer, chunks);
    const backendBaseUrl = resolveBackendBaseUrl();
    const backendToken = backendBaseUrl ? await getBackendSessionToken() : "";
    const directApiKey = await this.resolveApiKey(settings);
    const useBackend = Boolean(backendBaseUrl && backendToken);

    if (!useBackend && !directApiKey) {
      throw new Error(
        backendBaseUrl
          ? "Sign in to use cloud transcription."
          : "Cloud transcription requires VITE_API_URL or a Groq API key in settings.",
      );
    }

    log.info("Groq transcription requested", {
      byteLength: buffer.byteLength,
      segmentCount: segments.length,
      language: settings.language,
      dictionarySize: settings.customDictionary.length,
      backend: useBackend,
    });

    const started = Date.now();
    const texts = await Promise.all(
      segments.map((segment, index) =>
        useBackend
          ? this.uploadBackendSegment(segment, index, settings)
          : this.uploadGroqSegment(segment, index, settings, directApiKey),
      ),
    );
    const text = texts.join(" ").replace(/\s+/g, " ").trim();
    log.info("Groq transcription completed", { elapsedMs: Date.now() - started, textLength: text.length });
    return text;
  }

  private resolveSegments(buffer: ArrayBuffer, chunks: AudioChunk[]): AudioChunk[] {
    if (buffer.byteLength <= LARGE_AUDIO_THRESHOLD_BYTES) {
      return [{ buffer, mimeType: "audio/webm" }];
    }

    const usableChunks = chunks.filter((chunk) => chunk.buffer.byteLength > 0);
    if (usableChunks.length > 1) {
      log.debug("Using renderer-provided 240s audio chunks for large Groq upload", {
        chunkCount: usableChunks.length,
        sizes: usableChunks.map((chunk) => chunk.buffer.byteLength),
      });
      return usableChunks;
    }

    log.warn("Large audio exceeded chunk threshold but no valid chunk boundaries were provided; uploading as one file", {
      byteLength: buffer.byteLength,
    });
    return [{ buffer, mimeType: "audio/webm" }];
  }

  private async uploadBackendSegment(chunk: AudioChunk, index: number, settings: AppSettings): Promise<string> {
    const form = this.createTranscriptionForm(chunk, index, settings);
    form.append("provider", "groq");

    const started = Date.now();
    const response = await fetchBackend("/ai/transcriptions", {
      method: "POST",
      body: form,
    });

    const body = await response.text();
    const payload = this.parseResponse(body);

    log.debug("Backend Groq segment response received", {
      index,
      status: response.status,
      elapsedMs: Date.now() - started,
      textLength: payload.text?.length ?? 0,
    });

    if (!response.ok) {
      throw new Error(parseBackendError(body, `Backend transcription returned ${response.status}`));
    }

    return payload.text?.trim() ?? "";
  }

  private async uploadGroqSegment(
    chunk: AudioChunk,
    index: number,
    settings: AppSettings,
    apiKey: string,
  ): Promise<string> {
    const form = this.createTranscriptionForm(chunk, index, settings);
    const started = Date.now();
    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const body = await response.text();
    const payload = this.parseResponse(body);

    log.debug("Groq segment response received", {
      index,
      status: response.status,
      elapsedMs: Date.now() - started,
      textLength: payload.text?.length ?? 0,
    });

    if (!response.ok) {
      throw new Error(payload.error?.message || `Groq transcription returned ${response.status}`);
    }

    return payload.text?.trim() ?? "";
  }

  private createTranscriptionForm(chunk: AudioChunk, index: number, settings: AppSettings): FormData {
    const form = new FormData();
    const file = new Blob([new Uint8Array(chunk.buffer).slice()], { type: chunk.mimeType || "audio/webm" });
    form.append("file", file, `audio-${index + 1}.webm`);
    form.append("model", GROQ_MODEL);
    form.append("language", settings.language);

    const prompt = settings.customDictionary.join(" ").trim();
    if (prompt) form.append("prompt", prompt);

    return form;
  }

  private async resolveApiKey(settings: AppSettings): Promise<string> {
    return settings.groqApiKey.trim() || process.env.GROQ_API_KEY?.trim() || (await credentialStore.get("groqApiKey"));
  }

  private parseResponse(body: string): GroqTranscriptionResponse {
    if (!body) return {};
    try {
      return JSON.parse(body) as GroqTranscriptionResponse;
    } catch {
      return { error: { message: body } };
    }
  }
}

export const groqTranscriptionService = new GroqTranscriptionService();
