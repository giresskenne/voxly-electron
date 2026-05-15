import { createMainLogger } from "../debug-log";
import type { AppSettings, BillingPlan, BillingStatus, EntitlementStatus } from "../types";
import { fetchBackend, getBackendSessionToken, resolveBackendBaseUrl } from "./backend-api";
import { credentialStore } from "./credential-store";

const log = createMainLogger("entitlements");
const ENTITLEMENT_TTL_MS = 60_000;

const PLAN_CAPABILITIES: Record<BillingPlan, { cloud: boolean; cleanup: boolean }> = {
  free: { cloud: true, cleanup: true },
  starter: { cloud: true, cleanup: true },
  pro: { cloud: true, cleanup: true },
};

function parsePlan(value: unknown): BillingPlan {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "starter" || normalized === "pro") return normalized;
  return "free";
}

function parseStatus(value: unknown): BillingStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "active" ||
    normalized === "inactive" ||
    normalized === "paused" ||
    normalized === "past_due" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }
  // Backward-compatible support for alternate spelling from some providers.
  if (normalized === "canceled") return "cancelled";
  return "unknown";
}

function parseEmail(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized.includes("@") ? normalized : null;
}

function makeDefault(reason: string): EntitlementStatus {
  return {
    isAuthenticated: false,
    accountEmail: null,
    billingPlan: "free",
    billingStatus: "unknown",
    canUseCloudTranscription: false,
    canUseCleanup: true,
    checkedAt: new Date().toISOString(),
    source: "default",
    reason,
  };
}

export class EntitlementService {
  private cache: EntitlementStatus = makeDefault("not-checked");

  getCached(): EntitlementStatus {
    return this.cache;
  }

  async setSessionToken(token: string, refreshToken?: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) {
      await credentialStore.clear("sessionToken");
      await credentialStore.clear("refreshToken");
      this.cache = makeDefault("session-cleared");
      return;
    }

    await credentialStore.save("sessionToken", trimmed);
    if (refreshToken?.trim()) {
      await credentialStore.save("refreshToken", refreshToken.trim());
    }
    this.cache = makeDefault("session-updated");
  }

  async clearSessionToken(): Promise<void> {
    await credentialStore.clear("sessionToken");
    await credentialStore.clear("refreshToken");
    this.cache = makeDefault("session-cleared");
  }

  async refresh(force = false): Promise<EntitlementStatus> {
    if (!force) {
      const age = Date.now() - Date.parse(this.cache.checkedAt);
      if (Number.isFinite(age) && age >= 0 && age < ENTITLEMENT_TTL_MS) {
        return this.cache;
      }
    }

    if (!resolveBackendBaseUrl()) {
      // No backend configured — check if a token is stored anyway so we can
      // at least reflect the sign-in state without a network call.
      const token = await getBackendSessionToken();
      if (token) {
        // Keep the previous cache if it already reflects a real auth state.
        if (this.cache.isAuthenticated) return this.cache;
        // Otherwise mark as authenticated with unknown billing.
        this.cache = {
          isAuthenticated: true,
          accountEmail: this.cache.accountEmail,
          billingPlan: "free",
          billingStatus: "unknown",
          canUseCloudTranscription: false,
          canUseCleanup: true,
          checkedAt: new Date().toISOString(),
          source: "default",
          reason: "missing-api-url",
        };
        return this.cache;
      }
      this.cache = makeDefault("missing-api-url");
      return this.cache;
    }

    const token = await getBackendSessionToken();
    if (!token) {
      this.cache = makeDefault("missing-session-token");
      return this.cache;
    }

    try {
      const response = await fetchBackend("/auth/me", {
        method: "GET",
      });

      if (!response.ok) {
        const reason = response.status === 401 ? "unauthorized" : `http-${response.status}`;
        this.cache = makeDefault(reason);
        return this.cache;
      }

      const payload = (await response.json()) as {
        billingPlan?: unknown;
        billingStatus?: unknown;
        profile?: { billingPlan?: unknown; billingStatus?: unknown };
        user?: { billingPlan?: unknown; billingStatus?: unknown; email?: unknown };
        email?: unknown;
      };

      const accountEmail = parseEmail(payload.user?.email ?? payload.email);
      const billingPlan = parsePlan(
        payload.profile?.billingPlan ?? payload.billingPlan ?? payload.user?.billingPlan,
      );
      const billingStatus = parseStatus(
        payload.profile?.billingStatus ?? payload.billingStatus ?? payload.user?.billingStatus,
      );
      const planCapabilities = PLAN_CAPABILITIES[billingPlan];

      this.cache = {
        isAuthenticated: true,
        accountEmail,
        billingPlan,
        billingStatus,
        canUseCloudTranscription: planCapabilities.cloud,
        canUseCleanup: planCapabilities.cleanup,
        checkedAt: new Date().toISOString(),
        source: "remote",
      };
      return this.cache;
    } catch (error) {
      log.warn("Entitlement refresh failed", { error });
      // If we have a token, preserve authenticated state so the UI
      // doesn't drop to "signed out" just because the network is unavailable.
      const token = await getBackendSessionToken();
      if (token) {
        const prev = this.cache;
        this.cache = {
          isAuthenticated: true,
          accountEmail: prev.isAuthenticated ? prev.accountEmail : null,
          billingPlan: prev.isAuthenticated ? prev.billingPlan : "free",
          billingStatus: prev.isAuthenticated ? prev.billingStatus : "unknown",
          canUseCloudTranscription: prev.isAuthenticated ? prev.canUseCloudTranscription : false,
          canUseCleanup: true,
          checkedAt: new Date().toISOString(),
          source: "default",
          reason: "network-error",
        };
      } else {
        this.cache = makeDefault("network-error");
      }
      return this.cache;
    }
  }

  gateSettings(settings: AppSettings, entitlement: EntitlementStatus): AppSettings {
    const next = { ...settings };
    if (!entitlement.canUseCloudTranscription && next.transcriptionMode === "cloud") {
      next.transcriptionMode = "local";
    }
    if (!entitlement.canUseCleanup && next.cleanupEnabled) {
      next.cleanupEnabled = false;
    }
    return next;
  }

  gateSettingsPatch(patch: Partial<AppSettings>, entitlement: EntitlementStatus): Partial<AppSettings> {
    const next = { ...patch };
    if (!entitlement.canUseCloudTranscription && next.transcriptionMode === "cloud") {
      next.transcriptionMode = "local";
    }
    if (!entitlement.canUseCleanup && next.cleanupEnabled) {
      next.cleanupEnabled = false;
    }
    return next;
  }
}

export const entitlementService = new EntitlementService();
