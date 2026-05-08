import type { AppSettings, AudioChunk } from "../types";
import { createMainLogger } from "../debug-log";
import { credentialStore } from "./credential-store";

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
    const apiKey = await this.resolveApiKey(settings);
    if (!apiKey) {
      throw new Error("Cloud transcription requires GROQ_API_KEY or a Groq API key in settings.");
    }

    const segments = this.resolveSegments(buffer, chunks);
    log.info("Groq transcription requested", {
      byteLength: buffer.byteLength,
      segmentCount: segments.length,
      language: settings.language,
      dictionarySize: settings.customDictionary.length,
    });

    const started = Date.now();
    const texts = await Promise.all(
      segments.map((segment, index) => this.uploadSegment(segment, index, settings, apiKey)),
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

  private async uploadSegment(
    chunk: AudioChunk,
    index: number,
    settings: AppSettings,
    apiKey: string,
  ): Promise<string> {
    const form = new FormData();
    const file = new Blob([new Uint8Array(chunk.buffer).slice()], { type: chunk.mimeType || "audio/webm" });
    form.append("file", file, `audio-${index + 1}.webm`);
    form.append("model", GROQ_MODEL);
    form.append("language", settings.language);

    const prompt = settings.customDictionary.join(" ").trim();
    if (prompt) form.append("prompt", prompt);

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
