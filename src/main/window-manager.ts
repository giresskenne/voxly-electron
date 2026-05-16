import { BrowserWindow, app, screen, shell } from "electron";
import path from "node:path";
import type { AppSettings, RuntimeStatus } from "./types";
import { createMainLogger } from "./debug-log";

const isDev = !app.isPackaged;
const log = createMainLogger("windows");

function logFnFlow(message: string, meta?: unknown): void {
  if (!isDev) return;
  log.info(`[fn-flow] ${message}`, meta);
}

// Follows the same pattern as voxly/src/helpers/dragManager.js
class DragManager {
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private trackingInterval: ReturnType<typeof setInterval> | null = null;
  private targetWindow: BrowserWindow | null = null;

  setTargetWindow(win: BrowserWindow) {
    this.targetWindow = win;
  }

  start(): void {
    if (!this.targetWindow || this.targetWindow.isDestroyed()) return;
    this.isDragging = true;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = this.targetWindow.getPosition();
    this.dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
    this.trackingInterval = setInterval(() => {
      if (!this.isDragging || !this.targetWindow || this.targetWindow.isDestroyed()) {
        this.stop();
        return;
      }
      const pos = screen.getCursorScreenPoint();
      this.targetWindow.setPosition(pos.x - this.dragOffset.x, pos.y - this.dragOffset.y);
    }, 16);
    log.debug("Window drag started");
  }

  stop(): void {
    this.isDragging = false;
    if (this.trackingInterval !== null) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    log.debug("Window drag stopped");
  }

  cleanup(): void {
    this.stop();
    this.targetWindow = null;
  }
}

function enforceAlwaysOnTop(win: BrowserWindow): void {
  if (process.platform === "darwin") {
    // "screen-saver" (NSScreenSaverWindowLevel = 2000) ensures the overlay
    // stays above fullscreen apps, video players, and other floating windows.
    // visibleOnFullScreen keeps it on screen when another app goes fullscreen.
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    win.setFullScreenable(false);
  } else if (process.platform === "win32") {
    win.setAlwaysOnTop(true, "pop-up-menu");
  } else {
    win.setAlwaysOnTop(true, "screen-saver");
  }
}

export class WindowManager {
  overlay: BrowserWindow | null = null;
  settings: BrowserWindow | null = null;
  private dragManager = new DragManager();
  private panelStartPosition: "bottom-right" | "bottom-left" | "center" = "center";
  private hideUntil = 0;

  startWindowDrag(): void {
    this.dragManager.start();
  }

  stopWindowDrag(): void {
    this.dragManager.stop();
  }

  createOverlay(): BrowserWindow {
    if (this.overlay && !this.overlay.isDestroyed()) {
      log.debug("Reusing existing overlay window");
      return this.overlay;
    }

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor).workArea;
    const width = 360;
    const height = 540;
    const initialBounds = this.overlayBoundsForDisplay(display, width, height);
    log.info("Creating overlay window", { width, height, display });

    this.overlay = new BrowserWindow({
      width,
      height,
      x: initialBounds.x,
      y: initialBounds.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      focusable: true,
      fullscreenable: false,
      acceptFirstMouse: true,
      type: process.platform === "darwin" ? "panel" : "normal",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.overlay.setIgnoreMouseEvents(true, { forward: true });
    this.dragManager.setTargetWindow(this.overlay);
    const url = this.rendererUrl("overlay");
    log.debug("Loading overlay URL", { url });
    this.overlay.loadURL(url);
    this.overlay.once("ready-to-show", () => {
      log.info("Overlay ready to show");
      // Re-apply computed center bounds so the window is always in the correct
      // position even if the OS moved it during window creation.
      const cursorAtShow = screen.getCursorScreenPoint();
      const waAtShow = screen.getDisplayNearestPoint(cursorAtShow).workArea;
      this.overlay?.setBounds(this.overlayBoundsForDisplay(waAtShow, width, height));
      this.overlay?.showInactive();
      if (this.overlay) enforceAlwaysOnTop(this.overlay);
    });
    // Re-enforce after every navigation (dev hot-reload, etc.)
    this.overlay.webContents.on("did-finish-load", () => {
      if (this.overlay && !this.overlay.isDestroyed()) enforceAlwaysOnTop(this.overlay);
    });
    this.overlay.on("show", () => {
      if (this.overlay && !this.overlay.isDestroyed()) enforceAlwaysOnTop(this.overlay);
    });
    this.overlay.on("focus", () => {
      if (this.overlay && !this.overlay.isDestroyed()) enforceAlwaysOnTop(this.overlay);
    });
    this.overlay.on("closed", () => {
      log.info("Overlay window closed");
      this.dragManager.cleanup();
      this.overlay = null;
    });
    return this.overlay;
  }

  createSettings(): BrowserWindow {
    if (this.settings && !this.settings.isDestroyed()) {
      log.debug("Focusing existing settings window");
      this.settings.focus();
      return this.settings;
    }

    log.info("Creating settings window");
    this.settings = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 960,
      minHeight: 680,
      title: "Dicta Fun",
      show: false,
      backgroundColor: "#f8f9fb",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const url = this.rendererUrl("settings");
    log.debug("Loading settings URL", { url });
    this.settings.loadURL(url);
    this.settings.once("ready-to-show", () => {
      log.info("Settings ready to show");
      this.settings?.show();
    });
    this.settings.on("closed", () => {
      log.info("Settings window closed");
      this.settings = null;
    });
    this.settings.webContents.setWindowOpenHandler(({ url }) => {
      log.debug("Opening external URL from settings", { url });
      shell.openExternal(url);
      return { action: "deny" };
    });

    return this.settings;
  }

  isSettingsVisible(): boolean {
    if (!this.settings || this.settings.isDestroyed()) return false;
    return this.settings.isVisible() && !this.settings.isMinimized();
  }

  sendDictationToggle(): void {
    log.debug("Sending dictation toggle to overlay", { hasOverlay: Boolean(this.overlay && !this.overlay.isDestroyed()) });
    logFnFlow("window manager sending dictation:toggle", {
      hasOverlay: Boolean(this.overlay && !this.overlay.isDestroyed()),
      overlayVisible: Boolean(this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible()),
    });
    this.showDictationPanel();
    this.overlay?.webContents.send("dictation:toggle");
  }

  sendSettingsDictationToggle(): void {
    log.debug("Sending dictation toggle to settings", { hasSettings: Boolean(this.settings && !this.settings.isDestroyed()) });
    this.settings?.webContents.send("dictation:toggle");
  }

  sendDictationStart(): void {
    log.debug("Sending dictation start to overlay", { hasOverlay: Boolean(this.overlay && !this.overlay.isDestroyed()) });
    logFnFlow("window manager sending dictation:start", {
      hasOverlay: Boolean(this.overlay && !this.overlay.isDestroyed()),
      overlayVisible: Boolean(this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible()),
    });
    this.showDictationPanel();
    this.overlay?.webContents.send("dictation:start");
  }

  sendSettingsDictationStart(): void {
    log.debug("Sending dictation start to settings", { hasSettings: Boolean(this.settings && !this.settings.isDestroyed()) });
    this.settings?.webContents.send("dictation:start");
  }

  sendDictationStop(): void {
    log.debug("Sending dictation stop to overlay", { hasOverlay: Boolean(this.overlay && !this.overlay.isDestroyed()) });
    logFnFlow("window manager sending dictation:stop", {
      hasOverlay: Boolean(this.overlay && !this.overlay.isDestroyed()),
      overlayVisible: Boolean(this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible()),
    });
    this.overlay?.webContents.send("dictation:stop");
  }

  sendSettingsDictationStop(): void {
    log.debug("Sending dictation stop to settings", { hasSettings: Boolean(this.settings && !this.settings.isDestroyed()) });
    this.settings?.webContents.send("dictation:stop");
  }

  sendSettingsUpdated(settings: AppSettings): void {
    log.debug("Broadcasting settings:updated");
    for (const win of [this.overlay, this.settings]) {
      win?.webContents.send("settings:updated", settings);
    }
  }

  sendRuntimeStatus(status: RuntimeStatus): void {
    log.debug("Broadcasting runtime status", status);
    for (const win of [this.overlay, this.settings]) {
      win?.webContents.send("runtime:status", status);
    }
  }

  sendTranscriptionSaved(): void {
    log.debug("Broadcasting transcription:saved");
    this.settings?.webContents.send("transcription:saved");
  }

  sendSessionExpired(): void {
    log.warn("Broadcasting auth:session-expired");
    for (const win of [this.overlay, this.settings]) {
      win?.webContents.send("auth:session-expired");
    }
  }

  openSettingsTab(tab: string): void {
    log.debug("Opening settings tab", { tab });
    this.createSettings();
    // Small delay to ensure the window is loaded before sending the navigation event
    setTimeout(() => {
      this.settings?.webContents.send("settings:navigate-tab", tab);
    }, 150);
  }

  setOverlayInteractive(interactive: boolean): void {
    log.debug("Setting overlay interactivity", { interactive });
    if (process.platform === "win32") {
      this.overlay?.setIgnoreMouseEvents(false);
      return;
    }
    this.overlay?.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  showDictationPanel(options: { focus?: boolean } = {}): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;

    const wasVisible = this.overlay.isVisible();
    this.repositionOverlayToCursorDisplay();

    if (this.overlay.isMinimized()) {
      this.overlay.restore();
    }

    if (!this.overlay.isVisible()) {
      if (typeof this.overlay.showInactive === "function") {
        this.overlay.showInactive();
      } else {
        this.overlay.show();
      }
    }

    if (options.focus) {
      this.overlay.focus();
    }

    enforceAlwaysOnTop(this.overlay);
    logFnFlow("overlay show requested", {
      wasVisible,
      isVisible: this.overlay.isVisible(),
      focus: Boolean(options.focus),
      bounds: this.overlay.getBounds(),
    });
  }

  hideOverlayForHour(): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    this.hideUntil = Date.now() + 60 * 60 * 1000;
    this.overlay.hide();
    log.info("Overlay hidden for 1 hour");
    setTimeout(() => {
      if (!this.overlay || this.overlay.isDestroyed()) return;
      this.hideUntil = 0;
      this.overlay.showInactive();
      enforceAlwaysOnTop(this.overlay);
      log.info("Overlay visible again after 1-hour hide");
    }, 60 * 60 * 1000);
  }

  isHiddenByUser(): boolean {
    return Date.now() < this.hideUntil;
  }

  async prepareOverlayForPaste(): Promise<void> {
    if (!this.overlay || this.overlay.isDestroyed()) return;

    logFnFlow("preparing overlay for paste", {
      isFocused: this.overlay.isFocused(),
      isVisible: this.overlay.isVisible(),
      platform: process.platform,
    });
    this.setOverlayInteractive(false);

    if (!this.overlay.isFocused()) {
      logFnFlow("overlay was not focused before paste; no focus handoff needed");
      return;
    }

    if (process.platform === "darwin") {
      // Hiding a focused panel gives macOS a chance to reactivate the app that
      // owned the text cursor. showInactive restores the recorder without focus.
      this.overlay.hide();
      await delay(120);
      if (!this.overlay.isDestroyed()) {
        this.overlay.showInactive();
        enforceAlwaysOnTop(this.overlay);
      }
      logFnFlow("macOS overlay focus handoff completed for paste");
      return;
    }

    this.overlay.blur();
    await delay(80);
    logFnFlow("overlay blur handoff completed for paste");
  }

  private repositionOverlayToCursorDisplay(): void {
    if (!this.overlay || this.overlay.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const cursorDisplay = screen.getDisplayNearestPoint(cursor);
    const currentBounds = this.overlay.getBounds();
    const currentDisplay = screen.getDisplayNearestPoint({
      x: currentBounds.x + currentBounds.width / 2,
      y: currentBounds.y + currentBounds.height / 2,
    });

    if (currentDisplay.id === cursorDisplay.id) return;

    const workArea = cursorDisplay.workArea;
    const bounds = this.overlayBoundsForDisplay(workArea, currentBounds.width, currentBounds.height);
    this.overlay.setBounds(bounds);
    log.debug("Repositioned overlay to cursor display", { cursor, bounds });
  }

  private overlayBoundsForDisplay(
    workArea: Electron.Rectangle,
    width: number,
    height: number,
  ): Electron.Rectangle {
    const margin = 4;
    if (this.panelStartPosition === "bottom-left") {
      return {
        x: workArea.x + margin,
        y: workArea.y + workArea.height - height - margin,
        width,
        height,
      };
    }
    if (this.panelStartPosition === "center") {
      return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: workArea.y + workArea.height - height - margin,
        width,
        height,
      };
    }
    return {
      x: workArea.x + workArea.width - width - margin,
      y: workArea.y + workArea.height - height - margin,
      width,
      height,
    };
  }

  private rendererUrl(appName: "overlay" | "settings"): string {
    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      const url = `${process.env.ELECTRON_RENDERER_URL}?app=${appName}`;
      log.debug("Resolved dev renderer URL", { appName, url });
      return url;
    }
    const url = `file://${path.join(__dirname, "../renderer/index.html")}?app=${appName}`;
    log.debug("Resolved file renderer URL", { appName, url });
    return url;
  }
}

export const windows = new WindowManager();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
