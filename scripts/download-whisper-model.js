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

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (requestUrl) => {
      https.get(requestUrl, { headers: { "User-Agent": "dicta-fun-model-downloader" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          file.close();
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(dest, { force: true });
          return reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", (error) => {
          file.close();
          fs.rmSync(dest, { force: true });
          reject(error);
        });
      }).on("error", reject);
    };
    request(url);
  });
}

async function main() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  if (fs.existsSync(MODEL_PATH) && fs.statSync(MODEL_PATH).size >= MIN_MODEL_BYTES) {
    console.log("\nWhisper base model already exists, skipping download\n");
    return;
  }

  console.log("\nDownloading Whisper base model for local transcription...\n");
  console.log(`  Downloading from ${MODEL_URL}`);
  await downloadFile(MODEL_URL, MODEL_PATH);

  const stats = fs.statSync(MODEL_PATH);
  if (stats.size < MIN_MODEL_BYTES) {
    fs.rmSync(MODEL_PATH, { force: true });
    throw new Error(`Downloaded model is unexpectedly small (${stats.size} bytes)`);
  }
  console.log(`  Whisper base model ready (${Math.round(stats.size / 1024 / 1024)}MB)\n`);
}

main().catch((error) => {
  console.error(`  Failed to download Whisper model: ${error.message}\n`);
  process.exit(1);
});
