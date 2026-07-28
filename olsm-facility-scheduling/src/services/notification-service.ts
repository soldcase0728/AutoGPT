/**
 * What to notify, and to whom. Transport lives in integrations/notifications.
 *
 * Everything goes through the job queue so a mail provider outage never fails a
 * booking, and so a retry cannot send the same message twice (the idempotency
 * key covers it).
 */

import { BookingStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatRange } from "@/lib/time";
import { formatMoney } from "@/domain/pricing";
import { STATUS_LABELS } from "@/domain/booking-state";
import type { BumpCandidate } from "@/domain/priority";
import { enqueue } from "./job-queue";
import type { Actor } from "./booking-service";

/** State changes worth an email. DRAFT churn is not. */
const NOTIFY_ON: readonly BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.DENIED,
  BookingStatus.CANCELLED,
  BookingStatus.EXPIRED,
];

/** Time-sensitive events that also go out by SMS to opted-in users. */
const SMS_ON: readonly BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.DENIED,
  BookingStatus.CANCELLED,
];

export async function notifyBookingStateChange(
  bookingId: string,
  from: BookingStatus,
  to: BookingStatus,
): Promise<void> {
  if (!NOTIFY_ON.includes(to)) return;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      requester: true,
      subSpace: { include: { facility: true } },
      invoices: true,
    },
  });
  if (!booking) return;

  const where = `${booking.subSpace.facility.name} — ${booking.subSpace.name}`;
  const when = formatRange(booking.startAt, booking.endAt);
  const link = `${env.appUrl}/portal/bookings/${booking.id}`;

  const body = buildBody(to, booking.title, where, when, link, booking.invoices[0]?.totalCents);

  await enqueue({
    kind: "notify.email",
    payload: {
      to: booking.requester.email,
      subject: `[${booking.reference}] ${STATUS_LABELS[to]} — ${booking.title}`,
      text: body,
    },
    idempotencyKey: `notify:booking:${bookingId}:${to}`,
  });

  if (SMS_ON.includes(to) && booking.requester.smsOptIn && booking.requester.phone) {
    await enqueue({
      kind: "notify.sms",
      payload: {
        to: booking.requester.phone,
        body: `OLSM ${booking.reference}: ${STATUS_LABELS[to]}. ${booking.title}, ${where}, ${when}.`,
      },
      idempotencyKey: `notify-sms:booking:${bookingId}:${to}`,
    });
  }

  // Approvals need to reach the people who can act on them.
  if (to === BookingStatus.PENDING_APPROVAL) {
    await notifyApprovers(bookingId);
  }
}

async function notifyApprovers(bookingId: string): Promise<void> {
  const steps = await prisma.approvalStep.findMany({
    where: { bookingId, status: "PENDING" },
  });
  if (steps.length === 0) return;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { requester: true, subSpace: { include: { facility: true } } },
  });
  if (!booking) return;

  const recipients = new Set<string>();

  for (const step of steps) {
    if (step.requiredUserId) {
      const approver = await prisma.user.findUnique({ where: { id: step.requiredUserId } });
      if (approver?.active) recipients.add(approver.email);
    } else if (step.requiredRole) {
      const admins = await prisma.user.findMany({
        where: {
          active: true,
          role:
            step.requiredRole === Role.FACILITY_ADMIN
              ? { in: [Role.FACILITY_ADMIN, Role.SUPER_ADMIN] }
              : step.requiredRole,
        },
      });
      admins.forEach((a) => recipients.add(a.email));
    }
  }

  const text =
    `${booking.requester.name} requested ${booking.subSpace.facility.name} — ${booking.subSpace.name}\n` +
    `${booking.title} (${booking.activityType})\n` +
    `${formatRange(booking.startAt, booking.endAt)}\n\n` +
    `Approve or deny: ${env.appUrl}/admin/approvals`;

  for (const to of recipients) {
    await enqueue({
      kind: "notify.email",
      payload: {
        to,
        subject: `Approval needed: ${booking.title} [${booking.reference}]`,
        text,
      },
      idempotencyKey: `notify:approval:${bookingId}:${to}`,
    });
  }
}

export async function notifyBumped(
  victim: BumpCandidate,
  bumpedByReference: string,
  actor: Actor,
): Promise<void> {
  const refundLine =
    victim.paidAmountCents && victim.paidAmountCents > 0
      ? `\nA full refund of ${formatMoney(victim.paidAmountCents)} has been issued to your original payment method.`
      : "";

  await enqueue({
    kind: "notify.email",
    payload: {
      to: victim.requesterEmail,
      subject: `Your booking on ${formatRange(victim.startAt, victim.endAt)} has been cancelled`,
      text:
        `${victim.requesterName},\n\n` +
        `Your reservation "${victim.title}" (${victim.reference}) on ` +
        `${formatRange(victim.startAt, victim.endAt)} has been cancelled to make room for a ` +
        `higher-priority school activity (${bumpedByReference}).${refundLine}\n\n` +
        "We are sorry for the disruption. The athletic office can help you find another time: " +
        `${env.appUrl}/portal\n\n` +
        `— OLSM Athletics (change made by ${actor.name})`,
    },
    idempotencyKey: `notify:bumped:${victim.id}:${bumpedByReference}`,
  });

  if (victim.paidAmountCents && victim.paidAmountCents > 0) {
    await enqueue({
      kind: "notify.email",
      payload: {
        to: env.email.from,
        subject: `Credit offer needed: ${victim.reference}`,
        text:
          `${victim.requesterName} was bumped from ${formatRange(victim.startAt, victim.endAt)} ` +
          `and refunded ${formatMoney(victim.paidAmountCents)}. Offer a credit or a replacement slot.`,
      },
      idempotencyKey: `notify:bump-credit:${victim.id}`,
    });
  }
}

export async function notifyCalendarEditReverted(params: {
  editorEmail: string;
  bookingReference: string;
  bookingTitle: string;
  bookingId: string;
  differences: string[];
}): Promise<void> {
  await enqueue({
    kind: "notify.email",
    payload: {
      to: params.editorEmail,
      subject: `Your calendar change to ${params.bookingTitle} was reverted`,
      text:
        `A change you made in Google Calendar (${params.differences.join(", ")}) to ` +
        `"${params.bookingTitle}" [${params.bookingReference}] has been reverted.\n\n` +
        "Facility bookings are managed in the OLSM scheduling app, which checks for conflicts, " +
        "approvals, documents and payment. Google Calendar is a read-only view of what the app " +
        "has confirmed.\n\n" +
        `Make the change here instead: ${env.appUrl}/portal/bookings/${params.bookingId}`,
    },
    idempotencyKey: `notify:reverted:${params.bookingId}:${Date.now()}`,
  });
}

export async function notifyAdmins(subject: string, text: string, key: string): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { active: true, role: { in: [Role.SUPER_ADMIN, Role.FACILITY_ADMIN] } },
  });
  for (const admin of admins) {
    await enqueue({
      kind: "notify.email",
      payload: { to: admin.email, subject, text },
      idempotencyKey: `notify:admin:${key}:${admin.id}`,
    });
  }
}

function buildBody(
  to: BookingStatus,
  title: string,
  where: string,
  when: string,
  link: string,
  invoiceCents?: number,
): string {
  const header = `${title}\n${where}\n${when}\n`;

  switch (to) {
    case BookingStatus.CONFIRMED:
      return `${header}\nYour booking is confirmed and is now on the facility calendar.\n\n${link}`;
    case BookingStatus.PENDING_APPROVAL:
      return `${header}\nYour request has been submitted and is awaiting approval. The space is held for you in the meantime.\n\n${link}`;
    case BookingStatus.AWAITING_DOCUMENTS:
      return `${header}\nApproved. Before this can be confirmed we need your signed documents and a current certificate of insurance.\n\n${link}`;
    case BookingStatus.AWAITING_PAYMENT:
      return (
        `${header}\nDocuments are complete. ` +
        `${invoiceCents ? `An invoice for ${formatMoney(invoiceCents)} is ready.` : "An invoice is ready."}\n\n${link}`
      );
    case BookingStatus.DENIED:
      return `${header}\nThis request was not approved. The athletic office can explain and suggest alternatives.\n\n${link}`;
    case BookingStatus.CANCELLED:
      return `${header}\nThis booking has been cancelled.\n\n${link}`;
    case BookingStatus.EXPIRED:
      return `${header}\nThe hold on this slot expired because the outstanding documents or payment were not completed in time. The time has been returned to open inventory.\n\n${link}`;
    default:
      return `${header}\n${link}`;
  }
}
