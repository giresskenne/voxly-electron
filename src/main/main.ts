import { app, nativeImage, systemPreferences } from "electron";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { registerInitialHotkey, registerIpc, getRuntimeStatus } from "./ipc";
import { settingsStore } from "./services/settings-store";
import { transcriptionDatabase } from "./services/database";
import { whisperService } from "./services/whisper";
import { unregisterHotkeys } from "./services/hotkeys";
import { globeKeyManager } from "./services/globe-key-manager";
import { entitlementService } from "./services/entitlements";
import { queueDeepLink } from "./services/deep-links";
import { windows } from "./window-manager";
import { createMainLogger, ensureFileLogging } from "./debug-log";

// Development reads the ignored project .env. Packaged CI builds include
// resources/runtime.env with non-secret runtime config such as VITE_API_URL.
loadDotenv({ path: path.join(__dirname, "../../.env") });
loadDotenv({ path: path.join(__dirname, "../../resources/runtime.env"), override: true });

const log = createMainLogger("main");
const DEEP_LINK_PROTOCOL = "dictafun";

function getDeepLinkFromArgv(argv: string[]): string | null {
  const prefix = `${DEEP_LINK_PROTOCOL}://`;
  return argv.find((arg) => arg.toLowerCase().startsWith(prefix)) ?? null;
}

function dispatchDeepLink(url: string): void {
  queueDeepLink(url);
  windows.createSettings();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  const deepLink = getDeepLinkFromArgv(argv);
  if (!deepLink) return;
  log.info("Received deep link from second instance", { deepLink });
  dispatchDeepLink(deepLink);
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  log.info("Received deep link via open-url", { url });
  dispatchDeepLink(url);
});

// Set app name before ready so it shows correctly in Accessibility settings
app.name = "Dicta Fun";
app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
log.info("App bootstrapping", { isPackaged: app.isPackaged, platform: process.platform });

app.whenReady().then(async () => {
  ensureFileLogging();
  log.info("Electron ready");
  app.setAppUserModelId("com.dictafun.desktop");
  if (!app.isDefaultProtocolClient(DEEP_LINK_PROTOCOL)) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }

  // Packaged builds: electron-builder sets the icon via resources/icon.icns automatically.
  // Dev mode: set it at runtime using the PNG (nativeImage can't load .icns without a bundle).
  if (process.platform === "darwin" && app.dock) {
    // Always show the dock icon — without an explicit show() call, macOS can hide
    // the entry when the only windows are transparent overlay types.
    app.dock.show();
    if (!app.isPackaged) {
      try {
        const iconPath = path.join(app.getAppPath(), "resources", "icon.png");
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) app.dock.setIcon(icon);
      } catch {
        // non-fatal — dev only
      }
    }
  }

  // Request accessibility permission so the app appears in System Prefs → Accessibility
  // and macos-fast-paste (which calls AXIsProcessTrusted) can post key events.
  if (process.platform === "darwin") {
    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    log.info("Microphone permission status at startup", { micStatus });
    if (micStatus === "not-determined") {
      // Proactively request access so the OS shows the prompt before the first recording attempt.
      // If the user is in the middle of setup they'll see it once instead of the first time they hit record.
      log.info("Microphone access not yet determined — requesting proactively");
      systemPreferences.askForMediaAccess("microphone").then((granted) => {
        log.info("Microphone access prompt result", { granted });
      });
    }

    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    log.info("Accessibility trusted", { trusted });
    if (!trusted) {
      log.warn("Accessibility is not trusted; waiting for explicit user action before opening settings", {
        execPath: process.execPath,
      });
    }
  }

  log.debug("Loading settings");
  await settingsStore.load();
  const startupEntitlement = await entitlementService.refresh();
  const gatedStartupSettings = entitlementService.gateSettings(settingsStore.get(), startupEntitlement);
  if (
    gatedStartupSettings.transcriptionMode !== settingsStore.get().transcriptionMode ||
    gatedStartupSettings.cleanupEnabled !== settingsStore.get().cleanupEnabled
  ) {
    await settingsStore.save({
      transcriptionMode: gatedStartupSettings.transcriptionMode,
      cleanupEnabled: gatedStartupSettings.cleanupEnabled,
    });
  }
  log.debug("Initializing transcription database");
  await transcriptionDatabase.init();
  log.debug("Registering IPC handlers");
  registerIpc();
  log.debug("Prewarming Whisper service");
  await whisperService.prewarm(settingsStore.get());

  log.debug("Creating overlay window");
  windows.createOverlay();
  log.debug("Creating settings window");
  windows.createSettings();
  const argvDeepLink = getDeepLinkFromArgv(process.argv);
  if (argvDeepLink) {
    log.info("Received deep link from process argv", { argvDeepLink });
    dispatchDeepLink(argvDeepLink);
  }
  log.debug("Registering initial hotkey");
  registerInitialHotkey();
  log.debug("Broadcasting initial runtime status", getRuntimeStatus());
  windows.sendRuntimeStatus(getRuntimeStatus());

  app.on("activate", () => {
    log.info("App activated");
    windows.createSettings();
  });
});

app.on("window-all-closed", () => {
  // The overlay is the product surface; keep the process alive even if the settings panel closes.
  log.debug("All regular windows closed; keeping background process alive");
});

app.on("will-quit", () => {
  log.info("App will quit");
  whisperService.stop();
  globeKeyManager.stop();
  unregisterHotkeys();
});
