import { app, nativeImage, systemPreferences } from "electron";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { applyEntitlementGates, applyPostSignInSettings, registerInitialHotkey, registerIpc, getRuntimeStatus } from "./ipc";
import { settingsStore } from "./services/settings-store";
import { transcriptionDatabase } from "./services/database";
import { whisperService } from "./services/whisper";
import { unregisterHotkeys } from "./services/hotkeys";
import { globeKeyManager } from "./services/globe-key-manager";
import { windowsUiohookHotkeyManager } from "./services/windows-uiohook-hotkey-manager";
import { entitlementService } from "./services/entitlements";
import { desktopAuthCallbackService } from "./services/desktop-auth-callback";
import { windows } from "./window-manager";
import { createMainLogger, ensureFileLogging } from "./debug-log";
import { warmupAi } from "./services/backend-api";

// Development reads the ignored project .env. Packaged CI builds include
// resources/runtime.env with non-secret runtime config such as VITE_API_URL.
loadDotenv({ path: path.join(__dirname, "../../.env") });
loadDotenv({ path: path.join(__dirname, "../../resources/runtime.env"), override: true });

const log = createMainLogger("main");
const DEEP_LINK_PROTOCOL = "dictafun";
const pendingDeepLinks: string[] = [];
const pendingAuthDeepLinks: string[] = [];
let authDeepLinkHandlingReady = false;

type AuthDeepLinkPayload = {
  token: string;
  refreshToken?: string;
};

function getDeepLinkFromArgv(argv: string[]): string | null {
  const prefix = `${DEEP_LINK_PROTOCOL}://`;
  return argv.find((arg) => arg.toLowerCase().startsWith(prefix)) ?? null;
}

function parseAuthDeepLink(url: string): AuthDeepLinkPayload | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log.warn("Invalid deep link", { url });
    return null;
  }

  if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:` || parsed.hostname !== "auth") {
    return null;
  }

  const hashParams = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
  const token =
    parsed.searchParams.get("token") ??
    parsed.searchParams.get("access_token") ??
    hashParams.get("token") ??
    hashParams.get("access_token") ??
    "";

  if (!token.trim()) {
    log.warn("Auth deep link missing token");
    return null;
  }

  const refreshToken =
    parsed.searchParams.get("refresh_token") ??
    hashParams.get("refresh_token") ??
    undefined;

  return {
    token,
    refreshToken: refreshToken?.trim() ? refreshToken : undefined,
  };
}

async function applyAuthDeepLink(url: string): Promise<boolean> {
  const payload = parseAuthDeepLink(url);
  if (!payload) return false;

  if (!authDeepLinkHandlingReady) {
    pendingAuthDeepLinks.push(url);
    log.debug("Auth deep link queued until app services are ready");
    return true;
  }

  log.info("Applying auth deep link", { hasRefreshToken: Boolean(payload.refreshToken) });
  await entitlementService.setSessionToken(payload.token, payload.refreshToken);
  const entitlements = await entitlementService.refresh(true);
  const settings = await applyPostSignInSettings(entitlements);
  windows.sendSettingsUpdated(settings);
  windows.sendSessionUpdated(entitlements);
  windows.openSettingsTab("account");
  void warmupAi();
  log.info("Auth deep link applied", {
    authenticated: entitlements.isAuthenticated,
    billingPlan: entitlements.billingPlan,
    billingStatus: entitlements.billingStatus,
    hasRefreshToken: Boolean(payload.refreshToken),
  });
  return true;
}

async function flushPendingAuthDeepLinks(): Promise<void> {
  while (pendingAuthDeepLinks.length > 0) {
    const next = pendingAuthDeepLinks.shift();
    if (!next) continue;
    await applyAuthDeepLink(next);
  }
}

function dispatchRendererDeepLink(url: string): void {
  pendingDeepLinks.push(url);
  windows.createSettings();
  const settingsWindow = windows.settings;
  if (!settingsWindow || settingsWindow.isDestroyed()) return;

  const flush = () => {
    const win = windows.settings;
    if (!win || win.isDestroyed()) return;
    while (pendingDeepLinks.length > 0) {
      const next = pendingDeepLinks.shift();
      if (!next) continue;
      log.info("Dispatching deep link to renderer", { url: next });
      win.webContents.send("app:deep-link", next);
    }
  };

  // If the renderer is still loading (e.g. window just created or navigating),
  // defer until it finishes so the onDeepLink listener is registered before
  // we send — otherwise the IPC message is silently dropped.
  if (settingsWindow.webContents.isLoading()) {
    log.debug("Settings window still loading — deferring deep link dispatch");
    settingsWindow.webContents.once("did-finish-load", flush);
  } else {
    flush();
  }
}

function dispatchDeepLink(url: string): void {
  void applyAuthDeepLink(url)
    .then((handled) => {
      if (!handled) dispatchRendererDeepLink(url);
    })
    .catch((error) => {
      log.error("Failed to apply deep link", { error: error instanceof Error ? error.message : String(error) });
      dispatchRendererDeepLink(url);
    });
}

const startupDeepLink = getDeepLinkFromArgv(process.argv);
const hasSingleInstanceLock = app.requestSingleInstanceLock({ deepLink: startupDeepLink });
if (!hasSingleInstanceLock) {
  // Exit immediately — don't let app.quit()'s async delay cause whenReady() to
  // fire, open windows, or re-register the protocol handler mid-flight.
  process.exit(0);
}
log.info("Single-instance lock", { acquired: hasSingleInstanceLock });

app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
  const dataDeepLink =
    typeof additionalData === "object" &&
    additionalData !== null &&
    "deepLink" in additionalData &&
    typeof additionalData.deepLink === "string"
      ? additionalData.deepLink
      : null;
  log.info("Second instance launched", { argv, hasDataDeepLink: Boolean(dataDeepLink) });
  const deepLink = dataDeepLink ?? getDeepLinkFromArgv(argv);
  if (!deepLink) {
    log.warn("Second instance had no deep link in argv", { argv });
    return;
  }
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
  if (process.platform === "win32" && !app.isPackaged) {
    // Dev mode on Windows: always force-re-register so that a stale registry
    // entry (one without the extra script-path arg) never causes Electron to
    // treat the deep-link URL as the app path → "Cannot find module …?token=…".
    app.removeAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    log.debug("Deep link protocol registered (dev)", {
      execPath: process.execPath,
      scriptArg: path.resolve(process.argv[1]),
    });
  } else if (!app.isDefaultProtocolClient(DEEP_LINK_PROTOCOL)) {
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
  const currentStartupSettings = settingsStore.get();
  const startupPatch: Partial<typeof currentStartupSettings> = {};
  if (gatedStartupSettings.transcriptionMode !== currentStartupSettings.transcriptionMode) {
    startupPatch.transcriptionMode = gatedStartupSettings.transcriptionMode;
  }
  if (gatedStartupSettings.cleanupEnabled !== currentStartupSettings.cleanupEnabled) {
    startupPatch.cleanupEnabled = gatedStartupSettings.cleanupEnabled;
  }
  if (Object.keys(startupPatch).length > 0) {
    await settingsStore.save(startupPatch);
  }
  log.debug("Initializing transcription database");
  await transcriptionDatabase.init();
  log.debug("Registering IPC handlers");
  registerIpc();
  authDeepLinkHandlingReady = true;
  await flushPendingAuthDeepLinks();
  log.debug("Prewarming Whisper service");
  await whisperService.prewarm(settingsStore.get());

  log.debug("Creating overlay window");
  windows.createOverlay();
  log.debug("Creating settings window");
  windows.createSettings();
  if (startupDeepLink) {
    log.info("Received deep link from process argv", { argvDeepLink: startupDeepLink });
    dispatchDeepLink(startupDeepLink);
  }
  log.debug("Registering initial hotkey");
  registerInitialHotkey();
  log.debug("Broadcasting initial runtime status", getRuntimeStatus());
  windows.sendRuntimeStatus(getRuntimeStatus());
  // Fire-and-forget AI warmup so the first cloud dictation is faster.
  void warmupAi();

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
  desktopAuthCallbackService.stop();
  globeKeyManager.stop();
  windowsUiohookHotkeyManager.stop();
  unregisterHotkeys();
});
