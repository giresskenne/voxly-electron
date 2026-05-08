import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function normalizeLevel(value?: string | null): LogLevel | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return lower in LOG_LEVELS ? (lower as LogLevel) : null;
}

function readArgLogLevel(): LogLevel | null {
  const argv = process.argv || [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--log-level" && argv[i + 1]) return normalizeLevel(argv[i + 1]);
    if (arg.startsWith("--log-level=")) return normalizeLevel(arg.split("=", 2)[1]);
  }
  return null;
}

interface LogEntry {
  level?: string;
  message?: string;
  meta?: unknown;
  scope?: string;
  source?: string;
}

class DebugLogger {
  private logLevel: LogLevel;
  private levelValue: number;
  private logStream: fs.WriteStream | null = null;
  private fileLoggingEnabled = false;
  private fileLoggingPending: boolean;

  constructor() {
    this.logLevel = this.resolveLogLevel();
    this.levelValue = LOG_LEVELS[this.logLevel];
    this.fileLoggingPending = this.levelValue <= LOG_LEVELS.debug;
  }

  private resolveLogLevel(): LogLevel {
    return (
      readArgLogLevel() ??
      normalizeLevel(process.env.OPENWHISPR_LOG_LEVEL ?? process.env.VOXLY_DEBUG_LEVEL) ??
      (process.env.VOXLY_DEBUG === "1" ? "debug" : null) ??
      (process.env.NODE_ENV !== "production" ? "debug" : "info")
    );
  }

  getLevel(): LogLevel {
    return this.logLevel;
  }

  ensureFileLogging(): void {
    if (this.fileLoggingEnabled || !this.fileLoggingPending) return;
    if (!app.isReady()) return;

    try {
      const logsDir = path.join(app.getPath("userData"), "logs");
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logFile = path.join(logsDir, `debug-${timestamp}.log`);
      this.logStream = fs.createWriteStream(logFile, { flags: "a" });
      this.fileLoggingEnabled = true;
      this.fileLoggingPending = false;
      this.write("debug", "Debug logging enabled", { logFile }, "logger");
      this.write("info", "System info", {
        platform: process.platform,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        environment: process.env.NODE_ENV,
      }, "logger");
    } catch (e) {
      console.error("Failed to initialize debug log file:", e);
      this.fileLoggingPending = false;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.levelValue;
  }

  private formatMeta(meta: unknown): string {
    if (meta === undefined) return "";
    if (typeof meta === "string") return meta;
    try {
      return JSON.stringify(serializeValue(meta), null, 2);
    } catch {
      return String(meta);
    }
  }

  write(level: LogLevel, message: string, meta?: unknown, scope?: string, source = "main"): void {
    if (!this.shouldLog(level)) return;

    if (this.fileLoggingPending && !this.fileLoggingEnabled) {
      this.ensureFileLogging();
    }

    const timestamp = new Date().toISOString();
    const scopeTag = scope ? `[${scope}]` : "";
    const sourceTag = source !== "main" ? `[${source}]` : "";
    const levelTag = `[${level.toUpperCase()}]`;
    const metaText = meta !== undefined ? ` ${this.formatMeta(meta)}` : "";
    const logLine = `[${timestamp}] ${levelTag}${scopeTag}${sourceTag} ${message}${metaText}\n`;

    const consoleFn =
      level === "error" || level === "fatal"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;

    if (meta !== undefined) {
      consoleFn(`${levelTag}${scopeTag}${sourceTag} ${message}`, meta);
    } else {
      consoleFn(`${levelTag}${scopeTag}${sourceTag} ${message}`);
    }

    if (this.logStream) {
      this.logStream.write(logLine);
    }
  }

  logEntry(entry: LogEntry): void {
    const level = normalizeLevel(entry.level) ?? "info";
    this.write(level, String(entry.message ?? ""), entry.meta, entry.scope, entry.source ?? "renderer");
  }

  createScope(scope: string) {
    return {
      debug: (message: string, details?: unknown) => this.write("debug", message, details, scope),
      info: (message: string, details?: unknown) => this.write("info", message, details, scope),
      warn: (message: string, details?: unknown) => this.write("warn", message, details, scope),
      error: (message: string, details?: unknown) => this.write("error", message, details, scope),
    };
  }
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export const mainLogger = new DebugLogger();

export function createMainLogger(scope: string) {
  return mainLogger.createScope(scope);
}

export function ensureFileLogging(): void {
  mainLogger.ensureFileLogging();
}

export function getLogLevel(): string {
  return mainLogger.getLevel();
}

export function logRendererEntry(entry: unknown): void {
  mainLogger.logEntry(entry as LogEntry);
}
