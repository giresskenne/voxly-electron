#!/usr/bin/env node
/**
 * Fails CI if the unpacked Windows app is missing local transcription assets.
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appDir = path.join(root, "dist", "win-unpacked");
const checks = [
  {
    label: "Windows Whisper server",
    path: path.join(appDir, "resources", "bin", "whisper-server.exe"),
    minBytes: 100 * 1024,
  },
  {
    label: "Whisper runtime DLL",
    path: path.join(appDir, "resources", "bin", "whisper.dll"),
    minBytes: 100 * 1024,
  },
  {
    label: "Whisper base model",
    path: path.join(appDir, "resources", "models", "ggml-base.bin"),
    minBytes: 100 * 1024 * 1024,
  },
  {
    label: "uiohook Windows native module",
    path: path.join(appDir, "resources", "app.asar.unpacked", "node_modules", "uiohook-napi", "prebuilds", "win32-x64", "uiohook-napi.node"),
    minBytes: 100 * 1024,
  },
  {
    label: "uiohook JS entrypoint",
    path: path.join(appDir, "resources", "app.asar.unpacked", "node_modules", "uiohook-napi", "dist", "index.js"),
    minBytes: 1024,
  },
  {
    label: "node-gyp-build JS entrypoint",
    path: path.join(appDir, "resources", "app.asar.unpacked", "node_modules", "node-gyp-build", "node-gyp-build.js"),
    minBytes: 1024,
  },
];

let failed = false;

for (const check of checks) {
  try {
    const stats = fs.statSync(check.path);
    if (!stats.isFile()) {
      console.error(`${check.label} is not a file: ${check.path}`);
      failed = true;
      continue;
    }
    if (stats.size < check.minBytes) {
      console.error(`${check.label} is too small (${stats.size} bytes): ${check.path}`);
      failed = true;
      continue;
    }
    console.log(`${check.label} ok (${stats.size} bytes)`);
  } catch {
    console.error(`${check.label} missing: ${check.path}`);
    failed = true;
  }
}

if (failed) process.exit(1);
