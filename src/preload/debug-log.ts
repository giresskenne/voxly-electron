import { sanitizeLogValue } from "../shared/redaction";

type LogLevel = "debug" | "info" | "warn" | "error";

export function createPreloadLogger(scope: string) {
  function write(level: LogLevel, message: string, details?: unknown): void {
    if (!isDebugEnabled()) return;

    const prefix = `[Dicta Fun:${scope}] ${message}`;
    if (details === undefined) {
      console[level](prefix);
      return;
    }

    console[level](prefix, sanitizeLogValue(details));
  }

  return {
    debug: (message: string, details?: unknown) => write("debug", message, details),
    info: (message: string, details?: unknown) => write("info", message, details),
    warn: (message: string, details?: unknown) => write("warn", message, details),
    error: (message: string, details?: unknown) => write("error", message, details),
  };
}

function isDebugEnabled(): boolean {
  if (process.env.VOXLY_DEBUG === "1") return true;
  if (process.env.VOXLY_DEBUG === "0") return false;
  return process.env.NODE_ENV !== "production";
}
