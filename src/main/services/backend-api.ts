import { createMainLogger } from "../debug-log";
import { credentialStore } from "./credential-store";

const log = createMainLogger("backend-api");

/**
 * Thrown when the backend is reachable but explicitly rejected the request
 * (auth failure, rate limit, usage limit, etc.).
 * Callers MUST NOT fall back to offline alternatives for this error type.
 */
export class BackendRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendRejectedError";
  }
}

type BackendErrorPayload = {
  error?: {
    message?: unknown;
  };
  message?: unknown;
  detail?: unknown;
};

export function resolveBackendBaseUrl(): string {
  const raw = process.env.VITE_API_URL ?? process.env.API_URL ?? process.env.AUTH_API_URL ?? "";
  return raw.trim().replace(/\/+$/, "");
}

export async function getBackendSessionToken(): Promise<string> {
  return (await credentialStore.get("sessionToken")).trim();
}

// ─── Token refresh ────────────────────────────────────────────────────────────

let sessionExpiredCallback: (() => void) | null = null;

/** Register a callback that fires when the refresh token is also expired and the user must sign in again. */
export function setOnSessionExpired(cb: () => void): void {
  sessionExpiredCallback = cb;
}

let refreshInProgress: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  // Deduplicate concurrent refresh calls (e.g. Groq + cleanup both get 401 at the same time)
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = (async (): Promise<boolean> => {
    try {
      const refreshToken = (await credentialStore.get("refreshToken")).trim();
      if (!refreshToken) return false;

      const baseUrl = resolveBackendBaseUrl();
      if (!baseUrl) return false;

      const response = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        log.warn("Token refresh failed — clearing session", { status: response.status });
        await credentialStore.clear("sessionToken");
        await credentialStore.clear("refreshToken");
        sessionExpiredCallback?.();
        return false;
      }

      const data = (await response.json()) as { accessToken?: string; refreshToken?: string };
      if (!data.accessToken) return false;

      await credentialStore.save("sessionToken", data.accessToken);
      if (data.refreshToken) {
        await credentialStore.save("refreshToken", data.refreshToken);
      }
      log.info("Session token refreshed successfully");
      return true;
    } finally {
      refreshInProgress = null;
    }
  })();

  return refreshInProgress;
}

// ─── fetchBackend ─────────────────────────────────────────────────────────────

export async function fetchBackend(path: string, init: RequestInit = {}, _retryCount = 0): Promise<Response> {
  const baseUrl = resolveBackendBaseUrl();
  if (!baseUrl) {
    throw new Error("Missing backend URL. Set VITE_API_URL.");
  }

  const token = await getBackendSessionToken();
  if (!token) {
    throw new BackendRejectedError("Sign in to use this cloud feature.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const response = await fetch(`${baseUrl}${normalizePath(path)}`, {
    ...init,
    headers,
  });

  // On 401, attempt a silent token refresh and retry once.
  if (response.status === 401 && _retryCount === 0) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      return fetchBackend(path, init, 1);
    }
    throw new BackendRejectedError("Session expired. Please sign in again.");
  }

  return response;
}

export function parseBackendError(body: string, fallback: string): string {
  if (!body) return fallback;

  try {
    const payload = JSON.parse(body) as BackendErrorPayload;
    const message = payload.error?.message ?? payload.message ?? payload.detail;
    return typeof message === "string" && message.trim() ? message : fallback;
  } catch {
    return body.trim() || fallback;
  }
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

// ─── AI warmup ───────────────────────────────────────────────────────────────

let warmupLastAt = 0;
const WARMUP_TTL_MS = 6 * 60 * 1000; // 6 minutes

/**
 * Fire-and-forget AI warmup. Calls GET /ai/warmup to keep the backend warm.
 * Also pre-populates the AI capabilities cache. Throttled to WARMUP_TTL_MS.
 * Fails silently — callers should void the promise.
 */
export async function warmupAi(): Promise<void> {
  const now = Date.now();
  if (now - warmupLastAt < WARMUP_TTL_MS) return;
  warmupLastAt = now; // optimistic — prevents parallel calls
  const baseUrl = resolveBackendBaseUrl();
  if (!baseUrl) return;
  const token = await getBackendSessionToken();
  if (!token) return;
  try {
    // Pre-warm the capabilities cache in parallel.
    void getBackendAiCapabilities();
    await fetch(`${baseUrl}/ai/warmup`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    log.debug("AI warmup complete");
  } catch {
    log.debug("AI warmup failed — continuing");
    warmupLastAt = 0; // allow retry on next dictation
  }
}

type AiCapabilities = { cleanup: boolean; transcription: boolean };
let cachedCapabilities: AiCapabilities | null = null;
let capabilitiesFetchedAt = 0;
const CAPABILITIES_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Fetches and caches the backend's AI capabilities (no auth required). */
export async function getBackendAiCapabilities(): Promise<AiCapabilities> {
  const now = Date.now();
  if (cachedCapabilities !== null && now - capabilitiesFetchedAt < CAPABILITIES_TTL_MS) {
    return cachedCapabilities;
  }
  const baseUrl = resolveBackendBaseUrl();
  if (!baseUrl) return { cleanup: false, transcription: false };
  try {
    const response = await fetch(`${baseUrl}/ai/capabilities`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { cleanup: false, transcription: false };
    const data = (await response.json()) as Partial<AiCapabilities>;
    cachedCapabilities = {
      cleanup: data.cleanup === true,
      transcription: data.transcription === true,
    };
    capabilitiesFetchedAt = now;
    return cachedCapabilities;
  } catch {
    return { cleanup: false, transcription: false };
  }
}
