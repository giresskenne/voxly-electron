import { BrowserWindow, app, screen, shell } from "electron";
import path from "node:path";
import type { RuntimeStatus } from "./types";
import { createMainLogger } from "./debug-log";

const isDev = !app.isPackaged;
const log = createMainLogger("windows");

export class WindowManager {
  overlay: BrowserWindow | null = null;
  settings: BrowserWindow | null = null;

  createOverlay(): BrowserWindow {
    if (this.overlay && !this.overlay.isDestroyed()) {
      log.debug("Reusing existing overlay window");
      return this.overlay;
    }

    const display = screen.getPrimaryDisplay().workArea;
    const width = 360;
    const height = 540;
    log.info("Creating overlay window", { width, height, display });

    this.overlay = new BrowserWindow({
      width,
      height,
      x: display.x + display.width - width - 22,
      y: display.y + display.height - height - 22,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.overlay.setAlwaysOnTop(true, "screen-saver");
    this.overlay.setIgnoreMouseEvents(true, { forward: true });
    const url = this.rendererUrl("overlay");
    log.debug("Loading overlay URL", { url });
    this.overlay.loadURL(url);
    this.overlay.once("ready-to-show", () => {
      log.info("Overlay ready to show");
      this.overlay?.showInactive();
    });
    this.overlay.on("closed", () => log.info("Overlay window closed"));
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
      title: "Voxly",
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
    this.settings.on("closed", () => log.info("Settings window closed"));
    this.settings.webContents.setWindowOpenHandler(({ url }) => {
      log.debug("Opening external URL from settings", { url });
      shell.openExternal(url);
      return { action: "deny" };
    });

    return this.settings;
  }

  sendDictationToggle(): void {
    log.debug("Sending dictation toggle to overlay", { hasOverlay: Boolean(this.overlay && !this.overlay.isDestroyed()) });
    this.overlay?.webContents.send("dictation:toggle");
  }

  sendRuntimeStatus(status: RuntimeStatus): void {
    log.debug("Broadcasting runtime status", status);
    for (const win of [this.overlay, this.settings]) {
      win?.webContents.send("runtime:status", status);
    }
  }

  setOverlayInteractive(interactive: boolean): void {
    log.debug("Setting overlay interactivity", { interactive });
    this.overlay?.setIgnoreMouseEvents(!interactive, { forward: true });
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
