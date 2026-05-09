import { shell } from "electron";
import { createMainLogger } from "../debug-log";
import type { BillingInterval, CheckoutSession, PaidPlan } from "../types";
import { fetchBackend } from "./backend-api";

const log = createMainLogger("billing");

type CheckoutRequest = {
  plan: PaidPlan;
  interval: BillingInterval;
};

function assertCheckoutUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Checkout URL must use HTTPS.");
  }
  return parsed.toString();
}

export class BillingService {
  async startCheckout(input: CheckoutRequest): Promise<CheckoutSession> {
    const response = await fetchBackend("/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
