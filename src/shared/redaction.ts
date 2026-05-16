const REDACTED = "<redacted>";

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "auth_token",
  "id_token",
  "refresh_token",
  "session_token",
  "token",
]);

const SENSITIVE_KEY_PARTS = [
  "access_token",
  "authorization",
  "bearer",
  "id_token",
  "refresh_token",
  "session_token",
  "token",
  "secret",
  "password",
  "apikey",
  "api_key",
];

export function redactUrl(value: string): string {
  const bearerRedacted = redactBearerTokens(value);
  if (!bearerRedacted.includes("://")) return bearerRedacted;

  try {
    const parsed = new URL(bearerRedacted);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveQueryKey(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    return parsed.toString().replace(/%3Credacted%3E/g, REDACTED);
  } catch {
    return redactKnownQueryParams(bearerRedacted);
  }
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitize(value, new WeakSet<object>());
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactUrl(value);
  if (value instanceof ArrayBuffer) return { byteLength: value.byteLength };
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactUrl(value.message),
      stack: value.stack ? redactUrl(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (isSensitiveObjectKey(key) && typeof entry === "string" && entry.trim()) {
        return [key, redactSensitiveString(key, entry)];
      }
      return [key, sanitize(entry, seen)];
    }),
  );
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(normalized) || normalized.endsWith("_token");
}

function isSensitiveObjectKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-\s]/g, "_");
  if (normalized.endsWith("_source")) return false;
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function redactSensitiveString(key: string, value: string): string {
  if (key.toLowerCase() === "authorization" && /^bearer\s+/i.test(value)) {
    return "Bearer <redacted>";
  }
  return REDACTED;
}

function redactBearerTokens(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");
}

function redactKnownQueryParams(value: string): string {
  return value.replace(
    /([?&](?:access_token|auth_token|id_token|refresh_token|session_token|token)=)[^&#\s]+/gi,
    `$1${REDACTED}`,
  );
}
