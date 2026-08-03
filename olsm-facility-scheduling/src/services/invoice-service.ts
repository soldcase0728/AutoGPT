/**
 * Invoices, payment and refunds.
 *
 * The invoice is generated from the rate card at booking time and frozen. If
 * the AD changes a rate next month, an already-issued invoice does not move.
 */

import {
  InvoiceStatus,
  Prisma,
  RateTier,
  type Invoice,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { quote, type LineItem, type SurchargeSpec } from "@/domain/pricing";
import { bumpRefund, computeRefund, type RefundPolicy } from "@/domain/cancellation";
import {
  createCheckoutSession,
  refundPayment,
  stripeConfigured,
  StripeNotConfiguredError,
} from "@/integrations/payments/stripe";
import type { Actor } from "./booking-service";

const PAYMENT_DUE_DAYS = 5;

export async function createInvoiceForBooking(
  bookingId: string,
  rateTier: RateTier,
  actor: Actor,
  surcharges: readonly SurchargeSpec[] = [],
): Promise<Invoice | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { subSpace: { include: { facility: true } } },
  });
  if (!booking) throw new NotFoundError("Booking");

  const rateCards = await prisma.rateCard.findMany({
    where: { facilityId: booking.subSpace.facilityId },
  });

  const result = quote({
    rateCards,
    facilityId: booking.subSpace.facilityId,
    activityType: booking.activityType,
    rateTier,
    startAt: booking.startAt,
    endAt: booking.endAt,
    surcharges,
  });

  if (result.unpriced) {
    // No rate card matched. That is a configuration gap, not a free booking:
    // flag it for an admin rather than silently confirming a $0 rental.
    await recordAudit({
      entityType: "booking",
      entityId: bookingId,
      action: "invoice.unpriced",
      actorId: actor.id === "system" ? null : actor.id,
      actorLabel: actor.name,
      reason:
        `No rate card for ${booking.subSpace.facility.name} / ${booking.activityType} / ${rateTier}. ` +
        "Set one in Admin > Rates, then reissue the invoice.",
    });
  }

  const number = await nextInvoiceNumber();

  const invoice = await prisma.invoice.create({
    data: {
      bookingId,
      number,
      lineItems: result.lineItems as unknown as Prisma.InputJsonValue,
      subtotalCents: result.subtotalCents,
      totalCents: result.totalCents,
      status: result.totalCents === 0 ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
      issuedAt: new Date(),
      paidAt: result.totalCents === 0 ? new Date() : null,
      dueAt: new Date(Date.now() + PAYMENT_DUE_DAYS * 86_400_000),
    },
  });

  await recordAudit({
    entityType: "invoice",
    entityId: invoice.id,
    action: "invoice.issued",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    toState: invoice.status,
    payload: {
      bookingId,
      number,
      totalCents: invoice.totalCents,
      rateTier,
      rateCardId: result.rateCardId,
    },
  });

  return invoice;
}

export interface CheckoutHandoff {
  url: string;
  sessionId: string;
}

/** Hand the requester to Stripe Checkout. */
export async function startCheckout(invoiceId: string, actor: Actor): Promise<CheckoutHandoff> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { booking: { include: { requester: true, organization: true } } },
  });
  if (!invoice) throw new NotFoundError("Invoice");
  if (invoice.status === InvoiceStatus.PAID) throw new ValidationError("That invoice is already paid.");
  if (!stripeConfigured()) throw new StripeNotConfiguredError();

  const lineItems = (invoice.lineItems as unknown as LineItem[])
    .map((li) => ({
      label: li.label,
      amountCents: li.kind === "facility" && li.quantity !== 1 ? li.amountCents : li.unitAmountCents,
      quantity: 1,
    }));

  const session = await createCheckoutSession({
    invoiceId: invoice.id,
    bookingId: invoice.bookingId,
    bookingReference: invoice.booking.reference,
    customerEmail: invoice.booking.requester.email,
    stripeCustomerId: invoice.booking.organization?.stripeCustomerId,
    lineItems,
    successUrl: `${env.appUrl}/portal/invoices/${invoice.id}?paid=1`,
    cancelUrl: `${env.appUrl}/portal/invoices/${invoice.id}?cancelled=1`,
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { stripeSessionId: session.id },
  });

  await recordAudit({
    entityType: "invoice",
    entityId: invoice.id,
    action: "invoice.checkout_started",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    payload: { sessionId: session.id },
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Mark an invoice paid. Called by the Stripe webhook and, for cash or cheque,
 * by an admin recording an offline payment.
 */
export async function markInvoicePaid(
  invoiceId: string,
  actor: Actor,
  details: { paymentIntentId?: string; method?: string } = {},
): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new NotFoundError("Invoice");
  if (invoice.status === InvoiceStatus.PAID) return invoice;

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.PAID,
      paidAt: new Date(),
      stripePaymentIntentId: details.paymentIntentId ?? invoice.stripePaymentIntentId,
    },
  });

  await recordAudit({
    entityType: "invoice",
    entityId: invoiceId,
    action: "invoice.paid",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    fromState: invoice.status,
    toState: InvoiceStatus.PAID,
    payload: { method: details.method ?? "stripe", paymentIntentId: details.paymentIntentId ?? null },
  });

  return updated;
}

export interface RefundResult {
  refundCents: number;
  rationale: string;
  invoiceId: string | null;
}

/**
 * Refund on cancellation, per the policy on the booking's frozen rule snapshot.
 * `waivePolicy` refunds in full regardless of the window and is what a bump or
 * a weather cancellation uses.
 */
export async function refundInvoiceForCancellation(
  bookingId: string,
  actor: Actor,
  options: { waivePolicy?: boolean } = {},
): Promise<RefundResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { invoices: true, requirements: true },
  });
  if (!booking) throw new NotFoundError("Booking");

  const paid = booking.invoices.find((i) => i.status === InvoiceStatus.PAID);
  if (!paid) return { refundCents: 0, rationale: "No captured payment to refund.", invoiceId: null };

  const paidCents = paid.totalCents - paid.refundedCents;
  const snapshot = (booking.requirements?.ruleSnapshot ?? {}) as Partial<RefundPolicy>;
  const policy: RefundPolicy = {
    refundFullDays: snapshot.refundFullDays ?? 14,
    refundPartialDays: snapshot.refundPartialDays ?? 3,
    refundPartialPercent: snapshot.refundPartialPercent ?? 50,
  };

  const outcome = options.waivePolicy
    ? bumpRefund(paidCents)
    : computeRefund(paidCents, booking.startAt, policy);

  if (outcome.refundCents > 0) {
    if (stripeConfigured() && paid.stripePaymentIntentId) {
      await refundPayment({
        paymentIntentId: paid.stripePaymentIntentId,
        amountCents: outcome.refundCents,
        reason: outcome.rationale,
        idempotencyKey: `refund:${paid.id}:${outcome.refundCents}`,
      });
    }

    const refundedTotal = paid.refundedCents + outcome.refundCents;
    await prisma.invoice.update({
      where: { id: paid.id },
      data: {
        refundedCents: refundedTotal,
        status:
          refundedTotal >= paid.totalCents ? InvoiceStatus.REFUNDED : InvoiceStatus.PARTIALLY_REFUNDED,
      },
    });
  }

  // Logged either way -- "no refund was due" is exactly as important a record
  // as "we refunded $400". Acceptance criterion 10.
  await recordAudit({
    entityType: "invoice",
    entityId: paid.id,
    action: outcome.refundCents > 0 ? "invoice.refunded" : "invoice.refund_declined",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    reason: outcome.rationale,
    payload: {
      bookingId,
      refundCents: outcome.refundCents,
      percent: outcome.percent,
      policyWaived: options.waivePolicy ?? false,
      daysBeforeStart: Math.round(outcome.daysBeforeStart * 10) / 10,
    },
  });

  return { refundCents: outcome.refundCents, rationale: outcome.rationale, invoiceId: paid.id };
}

/** Invoices due for a T-5 / T-2 reminder. */
export async function invoicesNeedingReminder(now: Date = new Date()) {
  const in5 = new Date(now.getTime() + 5 * 86_400_000);
  return prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.ISSUED,
      dueAt: { not: null, lte: in5 },
    },
    include: { booking: { include: { requester: true } } },
  });
}

async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const count = await prisma.invoice.count({
    where: { createdAt: { gte: new Date(Date.UTC(year, 0, 1)) } },
  });
  return `INV-${year}-${String(count + 1).padStart(5, "0")}`;
}
