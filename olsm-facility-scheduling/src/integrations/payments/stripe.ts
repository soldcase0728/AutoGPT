/**
 * Stripe, over the REST API.
 *
 * No card data ever touches this application: the requester is sent to Stripe
 * Checkout and comes back with a session id. Security deposits use a
 * manual-capture PaymentIntent so the authorisation can simply be released
 * after the rental instead of being charged and refunded.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const API_BASE = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return Boolean(env.stripe.secretKey);
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured; payment steps are recorded but not charged.");
    this.name = "StripeNotConfiguredError";
  }
}

export class StripeApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "StripeApiError";
    this.status = status;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Stripe takes form-encoded bodies with bracketed nesting. */
function encodeForm(data: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(...encodeForm(item as Record<string, unknown>, `${name}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(...encodeForm(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

async function call<T>(
  path: string,
  data?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  if (!stripeConfigured()) throw new StripeNotConfiguredError();

  const headers: Record<string, string> = {
    authorization: `Bearer ${env.stripe.secretKey}`,
    "content-type": "application/x-www-form-urlencoded",
  };
  // Every mutating call carries an idempotency key so a retried job never
  // double-charges or double-refunds.
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method: data ? "POST" : "GET",
    headers,
    body: data ? encodeForm(data).join("&") : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new StripeApiError(`Stripe ${res.status}: ${text.slice(0, 500)}`, res.status);
  }
  return (await res.json()) as T;
}

export interface CheckoutLineItem {
  label: string;
  amountCents: number;
  quantity: number;
}

export interface CheckoutSession {
  id: string;
  url: string;
  paymentIntentId?: string;
}

export async function createCheckoutSession(params: {
  invoiceId: string;
  bookingId: string;
  bookingReference: string;
  customerEmail: string;
  lineItems: readonly CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  stripeCustomerId?: string | null;
}): Promise<CheckoutSession> {
  const body: Record<string, unknown> = {
    mode: "payment",
    // ACH keeps the fee off a five-figure seasonal rental.
    payment_method_types: ["card", "us_bank_account"],
    customer_email: params.stripeCustomerId ? undefined : params.customerEmail,
    customer: params.stripeCustomerId ?? undefined,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.invoiceId,
    metadata: {
      invoiceId: params.invoiceId,
      bookingId: params.bookingId,
      bookingReference: params.bookingReference,
    },
    line_items: params.lineItems.map((li) => ({
      quantity: li.quantity,
      price_data: {
        currency: "usd",
        unit_amount: li.amountCents,
        product_data: { name: li.label },
      },
    })),
  };

  const session = await call<{ id: string; url: string; payment_intent?: string }>(
    "/checkout/sessions",
    body,
    `checkout:${params.invoiceId}`,
  );

  return { id: session.id, url: session.url, paymentIntentId: session.payment_intent };
}

/** Manual-capture authorisation for a refundable security deposit. */
export async function authorizeDeposit(params: {
  invoiceId: string;
  amountCents: number;
  stripeCustomerId: string;
  paymentMethodId: string;
}): Promise<{ id: string; status: string }> {
  return call<{ id: string; status: string }>(
    "/payment_intents",
    {
      amount: params.amountCents,
      currency: "usd",
      customer: params.stripeCustomerId,
      payment_method: params.paymentMethodId,
      capture_method: "manual",
      confirm: true,
      off_session: true,
      metadata: { invoiceId: params.invoiceId, kind: "security_deposit" },
    },
    `deposit:${params.invoiceId}`,
  );
}

/** Release a deposit authorisation without charging it. */
export async function releaseDeposit(paymentIntentId: string): Promise<void> {
  await call(`/payment_intents/${paymentIntentId}/cancel`, {}, `deposit-release:${paymentIntentId}`);
}

/** Capture some or all of a held deposit (damage, unreturned equipment). */
export async function captureDeposit(
  paymentIntentId: string,
  amountCents: number,
): Promise<{ id: string; status: string }> {
  return call<{ id: string; status: string }>(
    `/payment_intents/${paymentIntentId}/capture`,
    { amount_to_capture: amountCents },
    `deposit-capture:${paymentIntentId}:${amountCents}`,
  );
}

export async function refundPayment(params: {
  paymentIntentId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<{ id: string; status: string }> {
  return call<{ id: string; status: string }>(
    "/refunds",
    {
      payment_intent: params.paymentIntentId,
      amount: params.amountCents,
      metadata: { reason: params.reason },
    },
    params.idempotencyKey,
  );
}

export async function retrieveSession(
  sessionId: string,
): Promise<{ id: string; payment_status: string; payment_intent?: string; amount_total?: number }> {
  return call(`/checkout/sessions/${sessionId}`);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verify the `Stripe-Signature` header. Constant-time compare, and the
 * timestamp must be recent so a captured payload cannot be replayed.
 */
export function verifyWebhookSignature(
  payload: string,
  header: string,
  secret = env.stripe.webhookSecret,
  toleranceSeconds = 300,
  now: number = Date.now(),
): StripeEvent {
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");

  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=")];
    }),
  );

  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(now / 1000 - timestamp) > toleranceSeconds) {
    throw new Error("Stripe webhook timestamp outside tolerance.");
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");

  const provided = parts.v1 ?? "";
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Stripe webhook signature mismatch.");
  }

  return JSON.parse(payload) as StripeEvent;
}

export const HANDLED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
] as const;
