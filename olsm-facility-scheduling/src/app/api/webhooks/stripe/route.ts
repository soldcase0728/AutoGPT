import { NextResponse, type NextRequest } from "next/server";
import { InvoiceStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { verifyWebhookSignature } from "@/integrations/payments/stripe";
import { markInvoicePaid } from "@/services/invoice-service";
import { advanceBooking } from "@/services/booking-service";

const SYSTEM_ACTOR = { id: "system", name: "stripe-webhook", role: Role.SUPER_ADMIN };

/**
 * Stripe webhook.
 *
 * Signature verification comes first and the raw body is used verbatim -- a
 * parsed-and-restringified body would not match the HMAC. Every handler is
 * idempotent because Stripe retries.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const payload = await request.text();

  let event;
  try {
    event = verifyWebhookSignature(payload, signature);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid signature." },
      { status: 400 },
    );
  }

  // Replay protection: Stripe event ids are unique and we have seen this one.
  const seen = await prisma.auditLog.findFirst({
    where: { entityType: "invoice", action: "stripe.webhook", payload: { path: ["eventId"], equals: event.id } },
  });
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  const object = event.data.object as Record<string, unknown>;

  switch (event.type) {
    case "checkout.session.completed": {
      const invoiceId = String(
        (object.metadata as Record<string, string> | undefined)?.invoiceId ??
          object.client_reference_id ??
          "",
      );
      if (!invoiceId) break;

      const paymentIntentId = object.payment_intent ? String(object.payment_intent) : undefined;
      const invoice = await markInvoicePaid(invoiceId, SYSTEM_ACTOR, {
        paymentIntentId,
        method: "stripe",
      });
      // Payment may be the last gate; re-run the state machine.
      await advanceBooking(invoice.bookingId, SYSTEM_ACTOR);
      await logEvent(event.id, event.type, invoiceId);
      break;
    }

    case "checkout.session.expired":
    case "payment_intent.payment_failed": {
      const invoiceId = String((object.metadata as Record<string, string> | undefined)?.invoiceId ?? "");
      if (!invoiceId) break;
      // The booking keeps its hold until the payment window closes; the expiry
      // sweep releases it. Nothing to do but record the attempt.
      await logEvent(event.id, event.type, invoiceId);
      break;
    }

    case "charge.refunded": {
      const paymentIntentId = object.payment_intent ? String(object.payment_intent) : null;
      if (!paymentIntentId) break;

      const invoice = await prisma.invoice.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
      });
      if (!invoice) break;

      const refundedCents = Number(object.amount_refunded ?? 0);
      if (refundedCents > invoice.refundedCents) {
        // Reconcile against a refund issued in the Stripe dashboard rather than
        // through this app.
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            refundedCents,
            status:
              refundedCents >= invoice.totalCents
                ? InvoiceStatus.REFUNDED
                : InvoiceStatus.PARTIALLY_REFUNDED,
          },
        });
      }
      await logEvent(event.id, event.type, invoice.id);
      break;
    }

    default:
      // Unhandled event types are acknowledged so Stripe stops retrying.
      break;
  }

  return NextResponse.json({ received: true });
}

async function logEvent(eventId: string, type: string, invoiceId: string): Promise<void> {
  await recordAudit({
    entityType: "invoice",
    entityId: invoiceId,
    action: "stripe.webhook",
    actorLabel: "stripe",
    payload: { eventId, type },
  });
}
