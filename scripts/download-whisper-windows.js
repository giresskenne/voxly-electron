#!/usr/bin/env node
/**
 * Downloads the official whisper.cpp Windows x64 server binary.
 *
 * The binary is intentionally not committed to git, but Windows packaged
 * builds must include whisper-server.exe and its DLL dependencies under
 * resources/bin.
 */

const { createHash } = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const WHISPER_CPP_VERSION = "v1.8.4";
const ARCHIVE_NAME = "whisper-bin-x64.zip";
const ARCHIVE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_VERSION}/${ARCHIVE_NAME}`;
const ARCHIVE_SHA256 = "74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e";
const BIN_DIR = path.join(__dirname, "..", "resources", "bin");
const SERVER_PATH = path.join(BIN_DIR, "whisper-server.exe");
const MAX_REDIRECTS = 8;
const REQUIRED_FILES = [
  "whisper-server.exe",
  "whisper.dll",
  "ggml.dll",
  "ggml-base.dll",
  "ggml-cpu.dll",
];

function isWindowsBuildRequested() {
  return process.platform === "win32" || process.argv.includes("--all");
}

function validateExecutable(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, reason: "missing" };
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) return { ok: false, reason: "not a file" };
  if (stats.size < 100 * 1024) return { ok: false, reason: `too small (${stats.size} bytes)` };
  const header = Buffer.alloc(2);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString("ascii") !== "MZ") return { ok: false, reason: "not a Windows PE executable" };
  return { ok: true, reason: "ok" };
}

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "dicta-fun-whisper-downloader" } }, (res) => {
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
      res.on("error", (error) => file.destroy(error));
      res.pipe(file);
    });

    request.on("error", (error) => {
      fs.rmSync(dest, { force: true });
      reject(error);
    });
  });
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function extractZip(zipPath, destDir) {
  if (process.platform === "win32") {
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destDir)} -Force`,
    ], { stdio: "inherit" });
    return;
  }

  execFileSync("unzip", ["-q", "-o", zipPath, "-d", destDir], { stdio: "inherit" });
}

function findRequiredFile(root, fileName) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return fullPath;
    if (entry.isDirectory()) {
      const found = findRequiredFile(fullPath, fileName);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  if (!isWindowsBuildRequested()) {
    console.log("\nSkipping whisper-server.exe download (Windows-only binary)\n");
    return;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const existing = validateExecutable(SERVER_PATH);
  if (existing.ok) {
    console.log("\nWindows Whisper server already exists, skipping download\n");
    return;
  }

  if (fs.existsSync(SERVER_PATH)) {
    console.log(`\nExisting whisper-server.exe is invalid (${existing.reason}); replacing it\n`);
    fs.rmSync(SERVER_PATH, { force: true });
  }

  console.log("\nDownloading Windows Whisper server for local transcription...\n");
  console.log(`  Downloading from ${ARCHIVE_URL}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dictafun-whisper-win-"));
  const zipPath = path.join(workDir, ARCHIVE_NAME);
  const extractDir = path.join(workDir, "extract");

  try {
    await downloadFile(ARCHIVE_URL, zipPath);
    const digest = sha256(zipPath);
    if (digest !== ARCHIVE_SHA256) {
      throw new Error(`SHA-256 mismatch for ${ARCHIVE_NAME}: expected ${ARCHIVE_SHA256}, got ${digest}`);
    }

    fs.mkdirSync(extractDir, { recursive: true });
    extractZip(zipPath, extractDir);

    for (const fileName of REQUIRED_FILES) {
      const source = findRequiredFile(extractDir, fileName);
      if (!source) throw new Error(`${fileName} not found in ${ARCHIVE_NAME}`);
      fs.copyFileSync(source, path.join(BIN_DIR, fileName));
    }

    const downloaded = validateExecutable(SERVER_PATH);
    if (!downloaded.ok) {
      throw new Error(`Downloaded whisper-server.exe is invalid: ${downloaded.reason}`);
    }

    const stats = fs.statSync(SERVER_PATH);
    console.log(`  Windows Whisper server ready (${Math.round(stats.size / 1024)}KB)\n`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`  Failed to download Windows Whisper server: ${error.message}\n`);
  process.exit(1);
});
