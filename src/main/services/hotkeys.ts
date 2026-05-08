import { globalShortcut } from "electron";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("hotkeys");

export function registerDictationHotkey(accelerator: string, onToggle: () => void): boolean {
  log.debug("Registering dictation hotkey", { accelerator });
  globalShortcut.unregisterAll();
  const registered = globalShortcut.register(accelerator, () => {
    log.info("Dictation hotkey triggered", { accelerator });
    onToggle();
  });
  log.info("Dictation hotkey registration finished", { accelerator, registered });
  return registered;
}

export function unregisterHotkeys(): void {
  log.debug("Unregistering all hotkeys");
  globalShortcut.unregisterAll();
}
