import { createMainLogger } from "../debug-log";

type UiohookModule = typeof import("uiohook-napi");
type UiohookKeyboardEvent = import("uiohook-napi").UiohookKeyboardEvent;

type PushHandlers = {
  onDown: () => void;
  onUp: () => void;
};

const log = createMainLogger("windows-uiohook-hotkey");
const SUPPORTED_HOTKEY = "Control+Super";

class WindowsUiohookHotkeyManager {
  private hook: UiohookModule["uIOhook"] | null = null;
  private key: UiohookModule["UiohookKey"] | null = null;
  private handlers: PushHandlers | null = null;
  private started = false;
  private ctrlDown = false;
  private metaDown = false;
  private comboActive = false;
  private readonly supported = process.platform === "win32";

  start(hotkey: string, handlers: PushHandlers): boolean {
    if (!this.supported || hotkey !== SUPPORTED_HOTKEY) return false;

    this.stop();
    this.handlers = handlers;

    try {
      const mod = require("uiohook-napi") as UiohookModule;
      this.hook = mod.uIOhook;
      this.key = mod.UiohookKey;
      this.hook.on("keydown", this.handleKeyDown);
      this.hook.on("keyup", this.handleKeyUp);
      this.hook.start();
      this.started = true;
      log.info("Windows Ctrl+Win push-to-talk listener started");
      return true;
    } catch (error) {
      this.stop();
      log.warn("Windows Ctrl+Win push-to-talk listener failed to start", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  stop(): void {
    if (this.hook) {
      this.hook.off("keydown", this.handleKeyDown);
      this.hook.off("keyup", this.handleKeyUp);
      if (this.started) {
        try {
          this.hook.stop();
        } catch (error) {
          log.warn("Windows Ctrl+Win push-to-talk listener failed to stop cleanly", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    this.hook = null;
    this.key = null;
    this.handlers = null;
    this.started = false;
    this.ctrlDown = false;
    this.metaDown = false;
    this.comboActive = false;
  }

  isRunning(): boolean {
    return this.started;
  }

  private handleKeyDown = (event: UiohookKeyboardEvent): void => {
    this.updateKeyState(event.keycode, true);
    if (!this.ctrlDown || !this.metaDown || this.comboActive) return;

    this.comboActive = true;
    this.handlers?.onDown();
  };

  private handleKeyUp = (event: UiohookKeyboardEvent): void => {
    const wasActive = this.comboActive;
    this.updateKeyState(event.keycode, false);
    if (!wasActive || (this.ctrlDown && this.metaDown)) return;

    this.comboActive = false;
    this.handlers?.onUp();
  };

  private updateKeyState(keycode: number, down: boolean): void {
    if (!this.key) return;
    if (keycode === this.key.Ctrl || keycode === this.key.CtrlRight) {
      this.ctrlDown = down;
    }
    if (keycode === this.key.Meta || keycode === this.key.MetaRight) {
      this.metaDown = down;
    }
  }
}

export const windowsUiohookHotkeyManager = new WindowsUiohookHotkeyManager();
