import { shell } from "electron";
import { createMainLogger } from "../debug-log";
import type { BillingInterval, CheckoutSession, PaidPlan } from "../types";
import { credentialStore } from "./credential-store";

const log = createMainLogger("billing");

type CheckoutRequest = {
  plan: PaidPlan;
  interval: BillingInterval;
};

function resolveApiBaseUrl(): string {
  const raw = process.env.VITE_API_URL ?? process.env.API_URL ?? process.env.AUTH_API_URL ?? "";
  return raw.trim().replace(/\/+$/, "");
}

function assertCheckoutUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Checkout URL must use HTTPS.");
  }
  return parsed.toString();
}

export class BillingService {
  async startCheckout(input: CheckoutRequest): Promise<CheckoutSession> {
    const apiBase = resolveApiBaseUrl();
    if (!apiBase) {
      throw new Error("Missing API base URL. Set VITE_API_URL for billing.");
    }

    const token = await credentialStore.get("sessionToken");
    if (!token) {
      throw new Error("You must sign in before starting checkout.");
    }

    const response = await fetch(`${apiBase}/billing/checkout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ plan: input.plan, interval: input.interval }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.warn("Checkout request failed", { status: response.status, body });
      throw new Error(`Checkout request failed (${response.status}).`);
    }

    const payload = (await response.json()) as {
      transactionId?: unknown;
      checkoutUrl?: unknown;
      plan?: unknown;
      interval?: unknown;
    };

    const checkoutUrl = assertCheckoutUrl(typeof payload.checkoutUrl === "string" ? payload.checkoutUrl : "");
    await shell.openExternal(checkoutUrl);

    return {
      transactionId: typeof payload.transactionId === "string" ? payload.transactionId : "",
      checkoutUrl,
      plan: input.plan,
      interval: input.interval,
      opened: true,
    };
  }
}

export const billingService = new BillingService();
