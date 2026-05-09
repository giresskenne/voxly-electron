import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, chmodSync, constants } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { createMainLogger } from "../debug-log";

const log = createMainLogger("globe-key");

const BINARY_NAME = "macos-globe-listener";

/**
 * Spawns the macos-globe-listener binary (arm64 Swift process) and emits
 * callbacks when the Globe / Fn key is pressed and released.
 * Only active on macOS; no-ops silently on other platforms.
 */
type GlobeKeyHandlers = {
  onDown: () => void;
  onUp?: () => void;
};

export class GlobeKeyManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private handlers: GlobeKeyHandlers | null = null;
  private supported = process.platform === "darwin";

  start(handlers: GlobeKeyHandlers): void {
    if (!this.supported) return;
    if (this.child) return; // already running

    this.handlers = handlers;

    const binary = this.resolveBinary();
    if (!binary) {
      log.warn("Globe listener binary not found; Globe/Fn key will not work");
      return;
    }

    // Ensure executable bit
    try {
      accessSync(binary, constants.X_OK);
    } catch {
      try {
        chmodSync(binary, 0o755);
      } catch (err) {
        log.warn("Could not chmod globe listener binary", { binary, err });
        return;
      }
    }

    log.info("Starting globe key listener", { binary });
    this.child = spawn(binary, [], { stdio: "pipe" });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        if (line === "FN_DOWN") {
          log.debug("Globe/Fn key down");
          this.handlers?.onDown();
        } else if (line === "FN_UP") {
          log.debug("Globe/Fn key up");
          this.handlers?.onUp?.();
        }
      }
    });

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      log.debug("Globe listener stderr", { text: chunk.trim() });
    });

    this.child.on("error", (err) => log.warn("Globe listener process error", err));
    this.child.on("exit", (code, signal) => {
      log.info("Globe listener process exited", { code, signal });
      this.child = null;
    });
  }

  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.handlers = null;
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  private resolveBinary(): string | null {
    // In packaged builds, binaries land in Resources/bin/ via extraResources.
    // Never reference app.getAppPath() in packaged mode — it points into app.asar
    // which spawn() cannot execute (ENOTDIR).
    const candidates = app.isPackaged
      ? [
          path.join(process.resourcesPath, "bin", BINARY_NAME),                                   // extraResources → Resources/bin/
          path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", BINARY_NAME), // asarUnpack fallback
        ]
      : [
          path.join(app.getAppPath(), "resources", "bin", BINARY_NAME),
          path.join(__dirname, "../../../resources/bin", BINARY_NAME),
        ];

    for (const p of candidates) {
      try {
        accessSync(p, constants.F_OK);
        return p;
      } catch {
        // not found at this path
      }
    }
    return null;
  }
}

export const globeKeyManager = new GlobeKeyManager();
