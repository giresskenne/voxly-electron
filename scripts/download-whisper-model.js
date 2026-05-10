#!/usr/bin/env node
/**
 * Downloads the default whisper.cpp base model used by local transcription.
 *
 * The model binary is intentionally not committed to git because it is large,
 * but packaged builds must include it under resources/models.
 */

const fs = require("fs");
const https = require("https");
const path = require("path");

const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODELS_DIR = path.join(__dirname, "..", "resources", "models");
const MODEL_PATH = path.join(MODELS_DIR, "ggml-base.bin");
const MIN_MODEL_BYTES = 100 * 1024 * 1024;
const MODEL_MAGIC = Buffer.from([0x6c, 0x6d, 0x67, 0x67]);
const MAX_REDIRECTS = 8;

function validateModel(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, reason: "missing" };

  const stats = fs.statSync(filePath);
  if (stats.size < MIN_MODEL_BYTES) {
    return { ok: false, reason: `too small (${stats.size} bytes)` };
  }

  const file = fs.openSync(filePath, "r");
  try {
    const magic = Buffer.alloc(MODEL_MAGIC.length);
    fs.readSync(file, magic, 0, magic.length, 0);
    if (!magic.equals(MODEL_MAGIC)) {
      return { ok: false, reason: `bad magic (${magic.toString("hex")})` };
    }
  } finally {
    fs.closeSync(file);
  }

  return { ok: true, reason: "ok" };
}

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "dicta-fun-model-downloader" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (!res.headers.location) {
          reject(new Error(`Redirect without Location header for ${url}`));
          return;
        }
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        const nextUrl = new URL(res.headers.location, url).toString();
        downloadFile(nextUrl, dest, redirects + 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const file = fs.createWriteStream(dest, { flags: "wx" });
      file.on("finish", () => file.close(resolve));
      file.on("error", (error) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(error);
      });
      res.on("error", (error) => {
        file.destroy(error);
      });
      res.pipe(file);
    });

    request.on("error", (error) => {
      fs.rmSync(dest, { force: true });
      reject(error);
    });
  });
}

async function main() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const existing = validateModel(MODEL_PATH);
  if (existing.ok) {
    console.log("\nWhisper base model already exists, skipping download\n");
    return;
  }

  if (fs.existsSync(MODEL_PATH)) {
    console.log(`\nExisting Whisper base model is invalid (${existing.reason}); replacing it\n`);
    fs.rmSync(MODEL_PATH, { force: true });
  }

  console.log("\nDownloading Whisper base model for local transcription...\n");
  console.log(`  Downloading from ${MODEL_URL}`);
  const tmpPath = `${MODEL_PATH}.download-${process.pid}`;
  fs.rmSync(tmpPath, { force: true });
  await downloadFile(MODEL_URL, tmpPath);

  const downloaded = validateModel(tmpPath);
  if (!downloaded.ok) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error(`Downloaded model is invalid: ${downloaded.reason}`);
  }

  fs.renameSync(tmpPath, MODEL_PATH);
  const stats = fs.statSync(MODEL_PATH);
  console.log(`  Whisper base model ready (${Math.round(stats.size / 1024 / 1024)}MB)\n`);
}

main().catch((error) => {
  console.error(`  Failed to download Whisper model: ${error.message}\n`);
  process.exit(1);
});
