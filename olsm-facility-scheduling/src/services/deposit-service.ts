/**
 * Security deposits.
 *
 * A deposit is an *authorization*, not a charge. Stripe holds the funds with
 * `capture_method: manual`; after the rental the hold is either released
 * (nothing taken, no refund needed, no card-fee churn) or partially captured up
 * to the authorized amount for damage or unreturned equipment.
 *
 * Charging and refunding instead would cost the school processing fees on money
 * it never meant to keep, and would put a real debit on a customer's statement
 * for a rental that went fine.
 */

import { InvoiceStatus, type Invoice } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { formatMoney } from "@/domain/pricing";
import {
  authorizeDeposit,
  captureDeposit,
  releaseDeposit,
  stripeConfigured,
} from "@/integrations/payments/stripe";
import { enqueue } from "./job-queue";
import type { Actor } from "./booking-service";

export type DepositState = "none" | "pending" | "held" | "released" | "captured";

export interface DepositStatus {
  state: DepositState;
  amountCents: number;
  capturedCents: number;
  intentId: string | null;
  /** True once the rental is over and the hold should be resolved. */
  awaitingResolution: boolean;
}

export async function depositStatus(invoiceId: string): Promise<DepositStatus> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { booking: true },
  });
  if (!invoice) throw new NotFoundError("Invoice");

  const state: DepositState =
    invoice.depositCents === 0
      ? "none"
      : invoice.depositCapturedCents > 0
        ? "captured"
        : invoice.depositResolvedAt
          ? "released"
          : invoice.depositIntentId
            ? "held"
            : "pending";

  return {
    state,
    amountCents: invoice.depositCents,
    capturedCents: invoice.depositCapturedCents,
    intentId: invoice.depositIntentId,
    awaitingResolution: state === "held" && invoice.booking.endAt < new Date(),
  };
}

/**
 * Place the hold. Requires a saved payment method, which Stripe Checkout gives
 * us once the rental fee is paid.
 */
export async function holdDeposit(
  invoiceId: string,
  paymentMethodId: string,
  actor: Actor,
): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { booking: { include: { organization: true } } },
  });
  if (!invoice) throw new NotFoundError("Invoice");
  if (invoice.depositCents <= 0) throw new ValidationError("This booking has no deposit.");
  if (invoice.depositIntentId) throw new ValidationError("A deposit is already held.");

  const customerId = invoice.booking.organization?.stripeCustomerId;
  if (!customerId) {
    throw new ValidationError(
      "No Stripe customer on file for this organization, so a deposit cannot be authorized.",
    );
  }

  if (!stripeConfigured()) {
    throw new ValidationError("Stripe is not configured; deposits cannot be authorized.");
  }

  const intent = await authorizeDeposit({
    invoiceId,
    amountCents: invoice.depositCents,
    stripeCustomerId: customerId,
    paymentMethodId,
  });

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { depositIntentId: intent.id },
  });

  await recordAudit({
    entityType: "invoice",
    entityId: invoiceId,
    action: "deposit.held",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    payload: { amountCents: invoice.depositCents, intentId: intent.id, status: intent.status },
  });

  return updated;
}

/** Release the hold in full: the rental went fine. */
export async function releaseHeldDeposit(
  invoiceId: string,
  actor: Actor,
  reason = "Rental completed with no damage.",
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { booking: { include: { requester: true } } },
  });
  if (!invoice) throw new NotFoundError("Invoice");
  if (!invoice.depositIntentId) throw new ValidationError("There is no deposit to release.");

  if (invoice.depositResolvedAt) {
    throw new ValidationError("That deposit has already been resolved.");
  }

  if (stripeConfigured()) {
    await releaseDeposit(invoice.depositIntentId);
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { depositResolvedAt: new Date(), depositCapturedCents: 0 },
  });

  await recordAudit({
    entityType: "invoice",
    entityId: invoiceId,
    action: "deposit.released",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    reason,
    payload: { amountCents: invoice.depositCents, intentId: invoice.depositIntentId },
  });

  await enqueue({
    kind: "notify.email",
    payload: {
      to: invoice.booking.requester.email,
      subject: `Your ${formatMoney(invoice.depositCents)} deposit has been released`,
      text:
        `${invoice.booking.requester.name},\n\n` +
        `The security deposit held for ${invoice.booking.title} has been released in full. ` +
        "Nothing was charged; the hold will disappear from your statement within a few days.\n\n" +
        "Thank you for leaving the space in good order.",
    },
    idempotencyKey: `deposit-released:${invoiceId}`,
  });
}

/**
 * Capture some or all of the hold. Requires a written reason -- keeping part of
 * someone's deposit is a decision that must be defensible later, and the reason
 * goes into both the audit log and the email to the renter.
 */
export async function captureHeldDeposit(
  invoiceId: string,
  amountCents: number,
  reason: string,
  actor: Actor,
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { booking: { include: { requester: true } } },
  });
  if (!invoice) throw new NotFoundError("Invoice");
  if (!invoice.depositIntentId) throw new ValidationError("There is no deposit to capture.");
  if (reason.trim().length < 10) {
    throw new ValidationError("Give a specific reason for keeping part of the deposit.");
  }
  if (amountCents <= 0) throw new ValidationError("Enter an amount greater than zero.");
  if (amountCents > invoice.depositCents) {
    throw new ValidationError(
      `You cannot capture more than the ${formatMoney(invoice.depositCents)} that was authorized.`,
    );
  }

  if (invoice.depositResolvedAt) {
    throw new ValidationError("That deposit has already been resolved.");
  }

  if (stripeConfigured()) {
    await captureDeposit(invoice.depositIntentId, amountCents);
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      depositCapturedCents: amountCents,
      depositResolvedAt: new Date(),
      depositCaptureReason: reason,
    },
  });

  await recordAudit({
    entityType: "invoice",
    entityId: invoiceId,
    action: "deposit.captured",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    reason,
    payload: {
      authorizedCents: invoice.depositCents,
      capturedCents: amountCents,
      releasedCents: invoice.depositCents - amountCents,
      intentId: invoice.depositIntentId,
    },
  });

  const kept = formatMoney(amountCents);
  const returned = formatMoney(invoice.depositCents - amountCents);

  await enqueue({
    kind: "notify.email",
    payload: {
      to: invoice.booking.requester.email,
      subject: `${kept} of your deposit has been retained`,
      text:
        `${invoice.booking.requester.name},\n\n` +
        `Following ${invoice.booking.title}, ${kept} of your ${formatMoney(invoice.depositCents)} ` +
        `security deposit has been retained and ${returned} released.\n\n` +
        `Reason: ${reason}\n\n` +
        "If you believe this is wrong, reply to this message and the athletic office will review it.",
    },
    idempotencyKey: `deposit-captured:${invoiceId}`,
  });
}

/** Deposits still held on rentals that finished. Drives an admin nudge. */
export async function depositsAwaitingResolution(now: Date = new Date()) {
  const invoices = await prisma.invoice.findMany({
    where: {
      depositIntentId: { not: null },
      depositCents: { gt: 0 },
      booking: { endAt: { lt: now } },
    },
    include: { booking: { include: { requester: true, subSpace: { include: { facility: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  // A Stripe authorization lapses on its own after about seven days, so an
  // unresolved hold is a deadline, not just untidiness.
  return invoices.filter((invoice) => invoice.depositResolvedAt === null);
}

export { formatMoney };
