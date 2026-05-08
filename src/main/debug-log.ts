import { app } from "electron";

type LogLevel = "debug" | "info" | "warn" | "error";

export function createMainLogger(scope: string) {
  function write(level: LogLevel, message: string, details?: unknown): void {
    if (!isDebugEnabled()) return;

    const prefix = `[Voxly:${scope}] ${message}`;
    if (details === undefined) {
      console[level](prefix);
      return;
    }

    console[level](prefix, sanitize(details));
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
  return !app.isPackaged;
}

function sanitize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) return value.map(sanitize);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.includes("apikey") || normalizedKey === "authorization") {
          return [key, typeof entry === "string" && entry ? "[redacted]" : entry];
        }
        if (normalizedKey.includes("text")) {
          return [key, typeof entry === "string" ? summarizeText(entry) : entry];
        }
        if (entry instanceof ArrayBuffer) return [key, { byteLength: entry.byteLength }];
        if (Buffer.isBuffer(entry)) return [key, { byteLength: entry.byteLength }];
        return [key, sanitize(entry)];
      }),
    );
  }

  return value;
}

function summarizeText(text: string): { length: number; preview: string } {
  return {
    length: text.length,
    preview: text.length > 80 ? `${text.slice(0, 80)}...` : text,
  };
}
