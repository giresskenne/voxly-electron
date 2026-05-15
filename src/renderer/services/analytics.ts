import type { CleanupStatus, RuntimeStatus } from "../../main/types";
import { redactUrl } from "../../shared/redaction";
import { createRendererLogger } from "../lib/debug-log";

const log = createRendererLogger("analytics");
const REDACTED = "<redacted>";
const MAX_STRING_LENGTH = 160;
const DISTINCT_ID_KEY = "dictafun:analyticsDistinctId";
const IDENTIFIED_EMAIL_KEY = "dictafun:analyticsIdentifiedEmail";

export type AnalyticsEventName =
  | "app_opened"
  | "onboarding_completed"
  | "dictation_started"
  | "dictation_raw_pasted"
  | "dictation_cleanup_completed"
  | "dictation_failed"
  | "upgrade_clicked"
  | "checkout_started";

export type DictationAnalyticsProperties = {
  transcriptionMode?: "local" | "cloud";
  cleanupMode?: "accurate" | "fast";
  cleanupStatus?: CleanupStatus;
  audioDurationMs?: number;
  audioPrepMs?: number;
  transcriptionMs?: number;
  cleanupMs?: number;
  pasteMs?: number;
  timeToRawPasteMs?: number;
  cleanupCompletedAfterPasteMs?: number | null;
  totalFinalizationMs?: number | null;
  wordCount?: number;
  replacement?: "skipped" | "replaced" | "failed";
  success?: boolean;
  failureStage?: string;
  errorType?: string;
};

type AnalyticsProperties = Record<string, unknown>;
type SanitizedProperties = Record<string, string | number | boolean | null | undefined>;

const posthogKey = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
const posthogHost = ((import.meta.env.VITE_POSTHOG_HOST ?? "").trim() || "https://us.i.posthog.com").replace(/\/+$/, "");

let disabledLogged = false;
let runtimeContextPromise: Promise<SanitizedProperties> | null = null;

export function capture(eventName: AnalyticsEventName, properties: AnalyticsProperties = {}): void {
  if (!isAnalyticsEnabled()) return;

  void (async () => {
    try {
      // Use PostHog's capture endpoint directly: no SDK autocapture, no session replay.
      const context = await getRuntimeContext();
      const sanitized = sanitizeAnalyticsProperties({
        ...context,
        ...properties,
        distinct_id: getAnonymousDistinctId(),
      });
      await fetch(`${posthogHost}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: posthogKey,
          event: eventName,
          properties: sanitized,
        }),
        keepalive: true,
      });
    } catch (error) {
      log.warn("PostHog capture failed", { eventName, error });
    }
  })();
}

export function identifyUserEmail(email: string | null | undefined): void {
  const normalized = normalizeEmail(email);
  if (!normalized || !isAnalyticsEnabled()) return;

  try {
    if (localStorage.getItem(IDENTIFIED_EMAIL_KEY) === normalized) return;
    localStorage.setItem(IDENTIFIED_EMAIL_KEY, normalized);
  } catch {
    // Continue without local de-duping.
  }

  void (async () => {
    try {
      // Account identity only: dictation capture calls still pass through the sanitizer and do not include email.
      await fetch(`${posthogHost}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: posthogKey,
          event: "$identify",
          properties: {
            distinct_id: getAnonymousDistinctId(),
            $set: { email: normalized },
          },
        }),
        keepalive: true,
      });
    } catch (error) {
      log.warn("PostHog identify failed", { error });
    }
  })();
}

export function resetAnalyticsIdentity(): void {
  try {
    localStorage.removeItem(IDENTIFIED_EMAIL_KEY);
  } catch {
    // no-op
  }
}

function isAnalyticsEnabled(): boolean {
  if (!posthogKey) {
    if (!disabledLogged) {
      disabledLogged = true;
      log.info("PostHog analytics disabled; VITE_POSTHOG_KEY is missing");
    }
    return false;
  }
  return true;
}

async function getRuntimeContext(): Promise<SanitizedProperties> {
  if (!runtimeContextPromise) {
    runtimeContextPromise = (async () => {
      try {
        const runtime: RuntimeStatus = await window.electronAPI.getRuntimeStatus();
        return sanitizeAnalyticsProperties({
          appVersion: runtime.appVersion,
          platform: runtime.platform,
          arch: runtime.arch,
        });
      } catch (error) {
        log.warn("Unable to load analytics runtime context", { error });
        return {};
      }
    })();
  }
  return runtimeContextPromise;
}

function getAnonymousDistinctId(): string {
  try {
    const existing = localStorage.getItem(DISTINCT_ID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    localStorage.setItem(DISTINCT_ID_KEY, next);
    return next;
  } catch {
    return "anonymous";
  }
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = (email ?? "").trim().toLowerCase();
  return normalized.includes("@") && normalized.length <= 254 ? normalized : null;
}

export function sanitizeAnalyticsProperties(properties: AnalyticsProperties): SanitizedProperties {
  const sanitized: SanitizedProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    sanitized[key] = sanitizeAnalyticsValue(key, value);
  }

  return sanitized;
}

function sanitizeAnalyticsValue(key: string, value: unknown): SanitizedProperties[string] {
  if (shouldRedactKey(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean" || typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return sanitizeString(value);
  if (value instanceof Error) return value.name || "Error";
  if (value instanceof ArrayBuffer || value instanceof Blob) return REDACTED;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (typeof value === "object") return "[object]";
  return String(value);
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
  if (["audio", "audiodata", "audioblob", "audiofile", "rawaudio"].includes(normalized)) return true;
  return [
    "access_token",
    "authorization",
    "bearer",
    "callback",
    "content",
    "context",
    "email",
    "password",
    "refresh_token",
    "secret",
    "selectedtext",
    "text",
    "token",
    "transcript",
    "url",
  ].some((part) => normalized.includes(part.replace(/[-_\s]/g, "")));
}

function sanitizeString(value: string): string {
  const redacted = redactUrl(value).replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");
  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}...`;
}
