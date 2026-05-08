import { globalShortcut } from "electron";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("hotkeys");

/**
 * GLOBE and Fn are handled by GlobeKeyManager (native binary), not globalShortcut.
 * Passing them here is a no-op that returns true so the rest of the app treats
 * the hotkey as "registered".
 */
function isGlobeLike(accelerator: string): boolean {
  return accelerator === "GLOBE" || accelerator === "Fn";
}

export function registerDictationHotkey(accelerator: string, onToggle: () => void): boolean {
  log.debug("Registering dictation hotkey", { accelerator });

  globalShortcut.unregisterAll();

  if (isGlobeLike(accelerator)) {
    log.info("GLOBE/Fn hotkey — handled by native globe-key-manager, skipping globalShortcut");
    return true;
  }

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
