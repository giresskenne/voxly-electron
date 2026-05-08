import { app } from "electron";
import { registerInitialHotkey, registerIpc, getRuntimeStatus } from "./ipc";
import { settingsStore } from "./services/settings-store";
import { transcriptionDatabase } from "./services/database";
import { whisperService } from "./services/whisper";
import { unregisterHotkeys } from "./services/hotkeys";
import { windows } from "./window-manager";
import { createMainLogger } from "./debug-log";

const log = createMainLogger("main");

app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
log.info("App bootstrapping", { isPackaged: app.isPackaged, platform: process.platform });

app.whenReady().then(async () => {
  log.info("Electron ready");
  app.setAppUserModelId("com.voxly.desktop");

  log.debug("Loading settings");
  await settingsStore.load();
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
  unregisterHotkeys();
});
