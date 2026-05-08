type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const normalizeLevel = (value?: string | null): LogLevel | null => {
  if (!value) return null;
  const lower = value.toLowerCase();
  return lower in LOG_LEVELS ? (lower as LogLevel) : null;
};

const defaultLevel: LogLevel = "debug";

let cachedLevel: LogLevel | null = null;
let levelPromise: Promise<LogLevel> | null = null;

const resolveLogLevel = async (): Promise<LogLevel> => {
  if (cachedLevel) return cachedLevel;
  if (!levelPromise) {
    levelPromise = (async () => {
      if (typeof window !== "undefined" && window.electronAPI?.getLogLevel) {
        try {
          const level = normalizeLevel(await window.electronAPI.getLogLevel());
          if (level) {
            cachedLevel = level;
            return level;
          }
        } catch {
          // fall back to default
        }
      }
      cachedLevel = defaultLevel;
      return defaultLevel;
    })();
  }
  return levelPromise;
};

const logToConsole = (level: LogLevel, message: string, meta?: unknown, scope?: string) => {
  const levelTag = `[${level.toUpperCase()}]`;
  const scopeTag = scope ? `[${scope}]` : "";
  const consoleFn =
    level === "error" || level === "fatal"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  if (meta !== undefined) {
    consoleFn(`${levelTag}${scopeTag} ${message}`, meta);
  } else {
    consoleFn(`${levelTag}${scopeTag} ${message}`);
  }
};

const log = async (level: LogLevel, message: string, meta?: unknown, scope?: string) => {
  const currentLevel = await resolveLogLevel();
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  if (typeof window !== "undefined" && window.electronAPI?.log) {
    try {
      await window.electronAPI.log({ level, message: String(message), meta, scope, source: "renderer" });
      return;
    } catch {
      // fall back to console
    }
  }

  logToConsole(level, String(message), meta, scope);
};

export function createRendererLogger(scope: string) {
  return {
    debug: (message: string, details?: unknown) => void log("debug", message, details, scope),
    info: (message: string, details?: unknown) => void log("info", message, details, scope),
    warn: (message: string, details?: unknown) => void log("warn", message, details, scope),
    error: (message: string, details?: unknown) => void log("error", message, details, scope),
  };
}
