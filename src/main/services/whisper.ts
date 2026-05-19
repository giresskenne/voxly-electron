import { app } from "electron";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AppSettings, RuntimeStatus } from "../types";
import { createMainLogger } from "../debug-log";
import { MOCK_TRANSCRIPTION_TEXT } from "./mock-transcription";

const log = createMainLogger("whisper");
const MIN_MODEL_BYTES = 100 * 1024 * 1024;
const GGML_MODEL_MAGIC = Buffer.from([0x6c, 0x6d, 0x67, 0x67]);

interface ModelValidation {
  ok: boolean;
  reason?: string;
  size?: number;
  magic?: string;
}

export class WhisperService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: RuntimeStatus["whisper"] = "mock";
  private activeServerKey: string | null = null;

  getStatus(): RuntimeStatus["whisper"] {
    log.debug("Whisper status requested", { status: this.status });
    return this.status;
  }

  async prewarm(settings: AppSettings): Promise<void> {
    log.info("Prewarm requested", {
      mockTranscription: settings.mockTranscription,
      transcriptionMode: settings.transcriptionMode,
      selectedModel: settings.selectedModel,
      whisperPort: settings.whisperPort,
    });
    if (settings.transcriptionMode === "cloud") {
      this.stop();
      this.status = "disabled";
      this.activeServerKey = null;
      log.info("Cloud transcription selected; skipping local whisper server prewarm");
      return;
    }

    if (settings.mockTranscription) {
      this.stop();
      this.status = "mock";
      this.activeServerKey = null;
      log.info("Using mock transcription; skipping whisper server prewarm");
      return;
    }

    const serverKey = `${settings.selectedModel}:${settings.whisperPort}`;
    if (this.child && this.status === "ready" && this.activeServerKey === serverKey) {
      log.debug("Whisper server already warm for current settings", { serverKey });
      return;
    }

    this.stop();

    const binary = this.resolveBinary();
    const model = this.resolveModel(settings.selectedModel);
    log.debug("Resolved whisper assets", { binary, model });

    if (!binary || !model) {
      this.status = "missing";
      log.warn("Whisper binary or model is missing", { binary, model });
      return;
    }

    this.status = "starting";
    this.activeServerKey = serverKey;
    log.info("Starting whisper server", { binary, model, port: settings.whisperPort });
    this.child = spawn(binary, ["--model", model, "--port", String(settings.whisperPort)], {
      stdio: "pipe",
    });

    this.child.stdout.on("data", (chunk) => log.debug("Whisper stdout", { text: String(chunk) }));
    this.child.stderr.on("data", (chunk) => log.warn("Whisper stderr", { text: String(chunk) }));

    this.child.once("error", (error) => {
      this.status = "error";
      log.error("Whisper server failed", error);
    });

    this.child.once("spawn", () => {
      this.status = "ready";
      log.info("Whisper server spawned");
      // Run a background warmup inference so the first user recording does not
      // pay the AVX/SIMD cold-start penalty (typically 10-16 s on first run).
      this.warmupInference(settings.whisperPort);
    });

    this.child.once("exit", (code, signal) => {
      log.warn("Whisper server exited", { code, signal });
      this.child = null;
      this.activeServerKey = null;
      if (this.status !== "mock") this.status = "error";
    });
  }

  async transcribe(buffer: ArrayBuffer, settings: AppSettings): Promise<string> {
    log.info("Transcription requested", {
      byteLength: buffer.byteLength,
      status: this.status,
      mockTranscription: settings.mockTranscription,
      cleanupEnabled: settings.cleanupEnabled,
      language: settings.language,
      dictionarySize: settings.customDictionary.length,
    });
    if (settings.mockTranscription) {
      log.debug("Returning mock transcription", { status: this.status });
      await new Promise((resolve) => setTimeout(resolve, 650));
      return MOCK_TRANSCRIPTION_TEXT;
    }

    if (this.status !== "ready") {
      log.warn("Local Whisper requested while unavailable", { status: this.status });
      throw new Error(this.unavailableMessage());
    }

    const form = new FormData();
    // Build the Blob directly from the in-memory buffer — no disk round-trip needed.
    const file = new Blob([buffer], { type: "audio/wav" });
    form.append("file", file, "audio.wav");
      // Windows local transcription is latency-sensitive; using the configured
      // language avoids whisper.cpp's auto-detection pass for the common path.
      const requestedLanguage = process.platform === "win32" && settings.language && settings.language !== "auto"
        ? settings.language
        : "auto";
      form.append("language", requestedLanguage);
      form.append("task", "transcribe");
      form.append("response_format", "json");
      form.append("temperature", "0.0");
      form.append("no_timestamps", "true");
      form.append("token_timestamps", "false");
      form.append("no_language_probabilities", "true");

      const durationMs = estimateWavDurationMs(buffer);
      const audioCtx = resolveFastAudioContext(durationMs);
      if (process.platform === "win32" && audioCtx > 0) {
        form.append("audio_ctx", String(audioCtx));
      }

      const prompt = settings.customDictionary.join(" ").trim();
      if (prompt) form.append("prompt", prompt);

      const started = Date.now();
      const response = await fetch(`http://127.0.0.1:${settings.whisperPort}/inference`, {
        method: "POST",
        body: form,
      });
      log.debug("Whisper inference response received", {
        status: response.status,
        elapsedMs: Date.now() - started,
        requestedLanguage,
        audioCtx,
        durationMs,
      });

      if (!response.ok) {
        throw new Error(`Whisper server returned ${response.status}`);
      }

      const payload = (await response.json()) as { text?: string };
      const rawText = payload.text?.trim() ?? "";
      // Whisper emits "[BLANK_AUDIO]" (and similar) when no speech was detected.
      // Return empty string so callers can silently skip pasting.
      const text = /^\[blank_audio\]$/i.test(rawText) ? "" : rawText;
      const logTranscripts = process.env.DICTAFUN_LOG_TRANSCRIPTS === "1";
      log.info("Whisper transcription completed", {
        ...(logTranscripts ? { text } : {}),
        textLength: text.length,
      });
    return text;
  }

  stop(): void {
    log.info("Stopping whisper service", { hasChild: Boolean(this.child) });
    this.child?.kill();
    this.child = null;
    this.activeServerKey = null;
  }

  /**
   * Send a tiny silent audio clip to whisper.cpp right after startup so that
   * the AVX/SIMD compute paths, decoder tensors, and CPU caches are warm before
   * the user first speaks.  The warmup is fire-and-forget; errors are ignored.
   */
  private async warmupInference(port: number): Promise<void> {
    const wav = buildSilentWav();
    const maxAttempts = 30; // up to 15 s of polling at 500 ms intervals
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Give the HTTP server inside whisper-server time to start accepting.
      await new Promise<void>((r) => setTimeout(r, 500));
      if (this.status !== "ready") return; // server stopped or replaced
      try {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "warmup.wav");
        form.append("language", "en");
        form.append("response_format", "json");
        form.append("temperature", "0.0");
        form.append("no_timestamps", "true");
        form.append("audio_ctx", "128");
        const started = Date.now();
        const resp = await fetch(`http://127.0.0.1:${port}/inference`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(25_000),
        });
        if (resp.ok) {
          log.info("Whisper inference warmup complete", { warmupMs: Date.now() - started });
          return;
        }
      } catch {
        // Server not yet accepting — retry
      }
    }
    log.warn("Whisper inference warmup gave up after max attempts");
  }

  private resolveBinary(): string | null {
    const name = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
    // In packaged builds, binaries land in Resources/bin/ via extraResources.
    // Never reference app.getAppPath() in packaged mode — it points into app.asar
    // which spawn() cannot execute (ENOTDIR).
    const candidate = app.isPackaged
      ? path.join(process.resourcesPath, "bin", name)
      : path.join(app.getAppPath(), "resources", "bin", name);
    if (!existsSync(candidate)) {
      log.warn("Whisper binary not found", { candidate });
      return null;
    }
    log.debug("Resolved whisper binary path", { candidate });
    return candidate;
  }

  private resolveModel(model: string): string | null {
    const candidate = app.isPackaged
      ? path.join(process.resourcesPath, "models", `ggml-${model}.bin`)
      : path.join(app.getAppPath(), "resources", "models", `ggml-${model}.bin`);
    const validation = this.validateModel(candidate);
    if (!validation.ok) {
      log.warn("Whisper model is missing or invalid", { model, candidate, ...validation });
      return null;
    }
    log.debug("Resolved whisper model path", { model, candidate });
    return candidate;
  }

  private validateModel(filePath: string): ModelValidation {
    if (!existsSync(filePath)) return { ok: false, reason: "missing" };

    const stats = statSync(filePath);
    if (stats.size < MIN_MODEL_BYTES) {
      return { ok: false, reason: "too small", size: stats.size };
    }

    const file = openSync(filePath, "r");
    try {
      const magic = Buffer.alloc(GGML_MODEL_MAGIC.length);
      readSync(file, magic, 0, magic.length, 0);
      if (!magic.equals(GGML_MODEL_MAGIC)) {
        return { ok: false, reason: "bad magic", size: stats.size, magic: magic.toString("hex") };
      }
    } finally {
      closeSync(file);
    }

    return { ok: true, size: stats.size };
  }

  private unavailableMessage(): string {
    if (this.status === "missing") {
      return "Local Whisper is missing or has a corrupt model/server binary. Rebuild the app with the Whisper assets included, or switch to cloud transcription.";
    }
    if (this.status === "error") {
      return "Local Whisper failed to start. Check the desktop logs, then restart Dicta Fun.";
    }
    return "Local Whisper is still starting. Try again in a moment.";
  }

}

function estimateWavDurationMs(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength <= 44) return null;
  const view = new DataView(buffer);
  const riff = readAscii(view, 0, 4);
  const wave = readAscii(view, 8, 4);
  if (riff !== "RIFF" || wave !== "WAVE") return null;

  const byteRate = view.getUint32(28, true);
  if (!byteRate) return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "data") {
      return Math.round((chunkSize / byteRate) * 1000);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return null;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let i = 0; i < length; i++) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

function resolveFastAudioContext(durationMs: number | null): number {
  if (durationMs === null) return 0;
  if (durationMs <= 2_000) return 128;
  if (durationMs <= 5_000) return 256;
  if (durationMs <= 10_000) return 512;
  if (durationMs <= 15_000) return 768;
  return 0;
}

/**
 * Build a minimal silent WAV (16-bit mono 16 kHz, 0.5 s) used for the
 * startup warmup inference.  All PCM samples are zero (silence).
 */
function buildSilentWav(): Buffer {
  const sampleRate = 16_000;
  const numSamples = 8_000; // 0.5 s
  const dataLen = numSamples * 2; // 16-bit = 2 bytes per sample
  const buf = Buffer.alloc(44 + dataLen, 0);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);              // PCM chunk size
  buf.writeUInt16LE(1, 20);              // format: PCM
  buf.writeUInt16LE(1, 22);              // channels: mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);              // block align
  buf.writeUInt16LE(16, 34);             // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  // PCM data is already zeroed by Buffer.alloc
  return buf;
}

export const whisperService = new WhisperService();
