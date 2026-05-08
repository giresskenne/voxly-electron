#!/usr/bin/env node
/**
 * Patches the Electron.app bundle in node_modules so that in dev mode:
 *   - The dock icon shows the Voxly icon (not the rocket)
 *   - System Settings → Accessibility shows "Voxly" (not "Electron")
 *   - CFBundleIdentifier matches the production app ID
 *
 * Runs automatically via "postinstall" in package.json.
 * Safe to re-run; it checks whether the patch is already applied.
 */

const fs = require("fs");
const path = require("path");

const ELECTRON_APP = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
);
const PLIST = path.join(ELECTRON_APP, "Contents", "Info.plist");
const ICNS_DEST = path.join(ELECTRON_APP, "Contents", "Resources", "electron.icns");
const ICNS_SRC = path.join(__dirname, "..", "resources", "icon.icns");

if (!fs.existsSync(ELECTRON_APP)) {
  console.log("patch-electron-bundle: Electron.app not found, skipping (Windows/Linux or not yet installed)");
  process.exit(0);
}

if (!fs.existsSync(ICNS_SRC)) {
  console.warn("patch-electron-bundle: resources/icon.icns not found, skipping icon patch");
} else {
  fs.copyFileSync(ICNS_SRC, ICNS_DEST);
  console.log("patch-electron-bundle: replaced electron.icns with Voxly icon");
}

// Patch Info.plist — replace CFBundleName and CFBundleIdentifier values
let plist = fs.readFileSync(PLIST, "utf8");

const already =
  plist.includes("<string>Voxly</string>") &&
  plist.includes("<string>com.voxly.desktop</string>");

if (already) {
  console.log("patch-electron-bundle: Info.plist already patched, skipping");
  process.exit(0);
}

// Replace CFBundleName value (comes right after the key)
plist = plist.replace(
  /(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/,
  "$1Voxly$2"
);

// Replace CFBundleIdentifier value
plist = plist.replace(
  /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/,
  "$1com.voxly.desktop$2"
);

fs.writeFileSync(PLIST, plist, "utf8");
console.log("patch-electron-bundle: patched Info.plist (CFBundleName=Voxly, CFBundleIdentifier=com.voxly.desktop)");
