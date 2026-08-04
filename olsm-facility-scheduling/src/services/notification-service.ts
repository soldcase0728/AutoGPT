/**
 * What to notify, and to whom. Transport lives in integrations/notifications.
 *
 * Everything goes through the job queue so a mail provider outage never fails a
 * booking, and so a retry cannot send the same message twice (the idempotency
 * key covers it).
 */

import { BookingStatus, Role, type TeamLevel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { dateColumnToISO, formatRange } from "@/lib/time";
import { formatMoney } from "@/domain/pricing";
import { STATUS_LABELS } from "@/domain/booking-state";
import { describeRecurrence } from "@/domain/recurrence";
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

/** The fields of a standing block a notification needs to describe it. */
interface StandingBlockNotice {
  id: string;
  rrule: string;
  startTime: string;
  endTime: string;
  teamLevel: TeamLevel;
  startDate: Date | null;
  endDate: Date | null;
  requestNote: string | null;
  sport: { name: string };
  subSpace: { name: string; facility: { name: string } };
  season: { name: string };
  createdBy: { name: string; email: string };
}

function describeStandingBlock(block: StandingBlockNotice): string {
  const level =
    block.teamLevel === "NONE" ? "" : ` ${block.teamLevel.replace("_", " ").toLowerCase()}`;
  const bounds =
    block.startDate || block.endDate
      ? ` (${block.startDate ? dateColumnToISO(block.startDate) : "season start"} to ${
          block.endDate ? dateColumnToISO(block.endDate) : "season end"
        })`
      : "";
  return (
    `${block.sport.name}${level} — ${block.subSpace.facility.name} — ${block.subSpace.name}\n` +
    `${describeRecurrence(block.rrule)}, ${block.startTime}–${block.endTime}\n` +
    `${block.season.name}${bounds}`
  );
}

export async function notifyStandingBlockRequested(
  block: StandingBlockNotice,
  requesterName: string,
): Promise<void> {
  const note = block.requestNote ? `\n"${block.requestNote}"\n` : "";
  await notifyAdmins(
    `Standing time requested: ${block.sport.name} — ${block.subSpace.facility.name}`,
    `${requesterName} requested recurring practice time:\n\n` +
      `${describeStandingBlock(block)}\n${note}\n` +
      `Approve or deny: ${env.appUrl}/admin/approvals`,
    `standing-block-request:${block.id}`,
  );
}

export async function notifyStandingBlockDecision(
  block: StandingBlockNotice,
  decision: "APPROVED" | "DENIED",
  outcome: {
    note: string | null;
    created: number;
    skippedDates: string[];
    awaitingSeasonPublish: boolean;
  },
): Promise<void> {
  const description = describeStandingBlock(block);

  let text: string;
  if (decision === "DENIED") {
    text =
      `${block.createdBy.name},\n\n` +
      `The athletic office did not approve your standing practice request:\n\n${description}\n\n` +
      `"${outcome.note}"\n\n` +
      `You can adjust and submit it again from your team page: ${env.appUrl}/my-team`;
  } else if (outcome.awaitingSeasonPublish) {
    text =
      `${block.createdBy.name},\n\n` +
      `Your standing practice request is approved:\n\n${description}\n\n` +
      "It goes on the calendar when the athletic office publishes the season schedule. " +
      `You can follow it here: ${env.appUrl}/my-team`;
  } else {
    const skipped =
      outcome.skippedDates.length > 0
        ? `\n\nThese dates could not be booked and were skipped: ${outcome.skippedDates.join(", ")}. ` +
          "The athletic office can help find alternatives for them."
        : "";
    text =
      `${block.createdBy.name},\n\n` +
      `Your standing practice time is approved and on the calendar:\n\n${description}\n\n` +
      `${outcome.created} session${outcome.created === 1 ? " was" : "s were"} booked.${skipped}\n\n` +
      `${env.appUrl}/my-team`;
  }

  await enqueue({
    kind: "notify.email",
    payload: {
      to: block.createdBy.email,
      subject:
        decision === "APPROVED"
          ? `Approved: ${block.sport.name} standing practice time`
          : `Not approved: ${block.sport.name} standing practice time`,
      text,
    },
    idempotencyKey: `notify:standing-block:${block.id}:${decision}`,
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
