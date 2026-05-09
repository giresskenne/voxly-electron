type LogLevel = "debug" | "info" | "warn" | "error";

export function createPreloadLogger(scope: string) {
  function write(level: LogLevel, message: string, details?: unknown): void {
    if (!isDebugEnabled()) return;

    const prefix = `[Dicta Fun:${scope}] ${message}`;
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
  return process.env.NODE_ENV !== "production";
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
          return [key, typeof entry === "string" ? { length: entry.length } : entry];
        }
        if (entry instanceof ArrayBuffer) return [key, { byteLength: entry.byteLength }];
        return [key, sanitize(entry)];
      }),
    );
  }

  return value;
}
