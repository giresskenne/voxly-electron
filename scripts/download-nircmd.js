#!/usr/bin/env node
/**
 * Downloads nircmd.exe for Windows builds.
 *
 * nircmd is a small utility for Windows that allows sending keyboard input
 * and other system commands. Used as a fallback for clipboard paste operations
 * when windows-fast-paste.exe is unavailable.
 *
 * Source: https://www.nirsoft.net/utils/nircmd.html
 * License: Free for non-commercial use
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const NIRCMD_URL = "https://www.nirsoft.net/utils/nircmd-x64.zip";
const BIN_DIR = path.join(__dirname, "..", "resources", "bin");
const NIRCMD_PATH = path.join(BIN_DIR, "nircmd.exe");

// ── Simple download helper (no external deps) ─────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (requestUrl) => {
      https.get(requestUrl, { headers: { "User-Agent": "voxly-electron-downloader" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          file.close();
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", (err) => { file.close(); fs.unlinkSync(dest); reject(err); });
      }).on("error", reject);
    };
    request(url);
  });
}

function extractZip(zipPath, destDir) {
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -NonInteractive -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Only needed for Windows builds
  if (process.platform !== "win32" && !process.argv.includes("--all")) {
    console.log("\nSkipping nircmd.exe download (Windows-only utility)\n");
    return;
  }

  console.log("\nDownloading nircmd.exe for Windows...\n");

  fs.mkdirSync(BIN_DIR, { recursive: true });

  if (fs.existsSync(NIRCMD_PATH)) {
    console.log("  nircmd.exe already exists, skipping\n");
    return;
  }

  const zipPath = path.join(BIN_DIR, "nircmd-x64.zip");
  const extractDir = path.join(BIN_DIR, "temp-nircmd");

  try {
    console.log(`  Downloading from ${NIRCMD_URL}`);
    await downloadFile(NIRCMD_URL, zipPath);

    console.log("  Extracting...");
    fs.mkdirSync(extractDir, { recursive: true });
    extractZip(zipPath, extractDir);

    const extractedPath = path.join(extractDir, "nircmd.exe");
    if (!fs.existsSync(extractedPath)) {
      console.error("  ✗ nircmd.exe not found in archive\n");
      process.exit(1);
    }

    fs.copyFileSync(extractedPath, NIRCMD_PATH);
    const stats = fs.statSync(NIRCMD_PATH);
    console.log(`  ✓ nircmd.exe downloaded (${Math.round(stats.size / 1024)}KB)\n`);
  } catch (error) {
    console.error(`  ✗ Failed to download nircmd.exe: ${error.message}\n`);
    process.exit(1);
  } finally {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

main().catch(console.error);
