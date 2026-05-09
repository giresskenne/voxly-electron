import { credentialStore } from "./credential-store";

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

export async function fetchBackend(path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = resolveBackendBaseUrl();
  if (!baseUrl) {
    throw new Error("Missing backend URL. Set VITE_API_URL.");
  }

  const token = await getBackendSessionToken();
  if (!token) {
    throw new Error("Sign in to use this cloud feature.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  return fetch(`${baseUrl}${normalizePath(path)}`, {
    ...init,
    headers,
  });
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
