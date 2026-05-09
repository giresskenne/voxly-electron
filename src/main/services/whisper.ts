import { app } from "electron";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AppSettings, RuntimeStatus } from "../types";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("whisper");

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
    if (settings.mockTranscription || this.status !== "ready") {
      log.debug("Returning mock transcription", { status: this.status });
      await new Promise((resolve) => setTimeout(resolve, 650));
      return "This is a test transcription. Your actual speech will appear here once you start recording.";
    }

    const dir = path.join(os.tmpdir(), "voxly");
    await mkdir(dir, { recursive: true });
    const audioPath = path.join(dir, `audio-${Date.now()}.wav`);
    await writeFile(audioPath, Buffer.from(buffer));
    log.debug("Temporary audio written", { audioPath, byteLength: buffer.byteLength });

    try {
      const form = new FormData();
      const audio = await this.fileToBuffer(audioPath);
      const file = new Blob([new Uint8Array(audio).slice()], { type: "audio/wav" });
      form.append("file", file, "audio.wav");
      form.append("language", settings.language);
      form.append("prompt", settings.customDictionary.join(" "));

      const started = Date.now();
      const response = await fetch(`http://127.0.0.1:${settings.whisperPort}/inference`, {
        method: "POST",
        body: form,
      });
      log.debug("Whisper inference response received", { status: response.status, elapsedMs: Date.now() - started });

      if (!response.ok) {
        throw new Error(`Whisper server returned ${response.status}`);
      }

      const payload = (await response.json()) as { text?: string };
      const rawText = payload.text?.trim() ?? "";
      // Whisper emits "[BLANK_AUDIO]" (and similar) when no speech was detected.
      // Return empty string so callers can silently skip pasting.
      const text = /^\[blank_audio\]$/i.test(rawText) ? "" : rawText;
      log.info("Whisper transcription completed", { text });
      return text;
    } finally {
      await rm(audioPath, { force: true });
      log.debug("Temporary audio removed", { audioPath });
    }
  }

  stop(): void {
    log.info("Stopping whisper service", { hasChild: Boolean(this.child) });
    this.child?.kill();
    this.child = null;
    this.activeServerKey = null;
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
    if (!existsSync(candidate)) {
      log.warn("Whisper model not found", { model, candidate });
      return null;
    }
    log.debug("Resolved whisper model path", { model, candidate });
    return candidate;
  }

  private fileToBuffer(filePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      createReadStream(filePath)
        .on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        .on("error", reject)
        .on("end", () => resolve(Buffer.concat(chunks)));
    });
  }
}

export const whisperService = new WhisperService();
