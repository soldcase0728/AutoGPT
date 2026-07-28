import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { formatRange } from "@/lib/time";
import { formatMoney } from "@/domain/pricing";
import { COI_WARNING_DAYS } from "@/domain/compliance";
import { processDueJobs, reclaimStuckJobs, registerHandler } from "@/services/job-queue";
import { registerCalendarHandlers, refreshWatchChannels } from "@/services/calendar-sync-service";
import { completePastBookings, releaseExpiredHolds } from "@/services/booking-service";
import { expiringCertificates, staffMissingAgreements } from "@/services/document-service";
import { invoicesNeedingReminder } from "@/services/invoice-service";
import { notifyAdmins } from "@/services/notification-service";
import { operationsSummary, setupBoard } from "@/services/reporting-service";
import { sendEmail, sendSms } from "@/integrations/notifications";
import { sendWaiverReminders } from "@/services/participant-service";
import { depositsAwaitingResolution } from "@/services/deposit-service";
import { pruneSessions } from "@/lib/auth/session";
import { enqueue } from "@/services/job-queue";

/**
 * Scheduled jobs, invoked by cron with a bearer token.
 *
 *   * /5 * * * *   process-queue     drain the outbound queue
 *   0 * * * *      expire-holds      release soft locks that ran out
 *   0 6 * * *      daily-digest      custodial setup board
 *   0 7 * * 1      weekly-digest     AD summary
 *   0 3 * * *      nightly           completions, COI warnings, session prune
 *   0 4 * * *      refresh-calendar-channels
 */
export async function POST(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const { name } = await context.params;
  registerHandlers();

  switch (name) {
    case "process-queue": {
      await reclaimStuckJobs();
      const result = await processDueJobs(50);
      if (result.exhausted.length > 0) {
        await notifyAdmins(
          "Background jobs failed permanently",
          result.exhausted
            .map((j) => `${j.kind} (${j.id}): ${j.error}`)
            .join("\n\n") + "\n\nThese will not retry. Investigate and requeue.",
          `jobs-exhausted:${new Date().toISOString().slice(0, 13)}`,
        );
      }
      return NextResponse.json(result);
    }

    case "expire-holds": {
      const released = await releaseExpiredHolds();
      return NextResponse.json({ released });
    }

    case "daily-digest": {
      const sent = await sendCustodialDigest();
      return NextResponse.json({ sent });
    }

    case "weekly-digest": {
      const sent = await sendAdDigest();
      return NextResponse.json({ sent });
    }

    case "nightly": {
      const completed = await completePastBookings();
      const warned = await warnExpiringCertificates();
      const sessions = await pruneSessions();
      const reminders = await sendPaymentReminders();
      const waivers = await sendWaiverReminders();
      const deposits = await nudgeUnresolvedDeposits();
      return NextResponse.json({ completed, warned, sessions, reminders, waivers, deposits });
    }

    case "refresh-calendar-channels": {
      const refreshed = await refreshWatchChannels();
      return NextResponse.json({ refreshed });
    }

    default:
      return NextResponse.json({ error: `Unknown job "${name}".` }, { status: 404 });
  }
}

function authorized(request: NextRequest): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = env.jobRunnerToken;
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

let handlersRegistered = false;

function registerHandlers(): void {
  if (handlersRegistered) return;
  registerCalendarHandlers();

  registerHandler("notify.email", async (payload) => {
    await sendEmail({
      to: String(payload.to),
      subject: String(payload.subject),
      text: String(payload.text),
      html: payload.html ? String(payload.html) : undefined,
    });
  });

  registerHandler("notify.sms", async (payload) => {
    await sendSms({ to: String(payload.to), body: String(payload.body) });
  });

  registerHandler("invoice.reminder", async (payload) => {
    await sendEmail({
      to: String(payload.to),
      subject: String(payload.subject),
      text: String(payload.text),
    });
  });

  handlersRegistered = true;
}

async function sendCustodialDigest(): Promise<number> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);

  const bookings = await setupBoard(start, end);
  const staff = await prisma.user.findMany({
    where: { active: true, role: { in: [Role.FACILITIES, Role.FACILITY_ADMIN] } },
  });

  const body =
    bookings.length === 0
      ? "Nothing is booked today."
      : bookings
          .map(
            (b) =>
              `${formatRange(b.startAt, b.endAt)} — ${b.subSpace.facility.name} / ${b.subSpace.name}\n` +
              `  ${b.title} (${b.requester.name}${b.headcount ? `, ${b.headcount} people` : ""})` +
              (b.setupNotes ? `\n  SETUP: ${b.setupNotes}` : "") +
              (b.equipmentNotes ? `\n  EQUIPMENT: ${b.equipmentNotes}` : ""),
          )
          .join("\n\n");

  for (const person of staff) {
    await enqueue({
      kind: "notify.email",
      payload: {
        to: person.email,
        subject: `Today's facility setup — ${bookings.length} booking${bookings.length === 1 ? "" : "s"}`,
        text: `${body}\n\nFull board: ${env.appUrl}/custodial`,
      },
      idempotencyKey: `digest:custodial:${start.toISOString().slice(0, 10)}:${person.id}`,
    });
  }

  return staff.length;
}

async function sendAdDigest(): Promise<number> {
  const summary = await operationsSummary();
  const admins = await prisma.user.findMany({
    where: { active: true, role: { in: [Role.SUPER_ADMIN, Role.FACILITY_ADMIN] } },
  });

  const text = [
    `Pending approvals: ${summary.pendingApprovals}`,
    `Awaiting documents: ${summary.awaitingDocuments}`,
    `Awaiting payment: ${summary.awaitingPayment}`,
    `Unpaid invoices: ${formatMoney(summary.unpaidInvoiceCents)}`,
    `Certificates expiring within ${COI_WARNING_DAYS} days: ${summary.expiringCoiCount}`,
    `Coaching accounts without a current agreement: ${summary.unsignedAgreementCount}`,
    `Denied in the last 30 days: ${summary.deniedLast30}`,
    `Bumped in the last 30 days: ${summary.bumpedLast30}`,
    `No-shows in the last 30 days: ${summary.noShowLast30}`,
    summary.failedCalendarSyncs > 0
      ? `CALENDAR SYNC FAILURES: ${summary.failedCalendarSyncs} — these bookings are not on Google.`
      : "",
    "",
    `Reports: ${env.appUrl}/admin/reports`,
  ]
    .filter(Boolean)
    .join("\n");

  const week = new Date().toISOString().slice(0, 10);
  for (const admin of admins) {
    await enqueue({
      kind: "notify.email",
      payload: { to: admin.email, subject: "Weekly facility summary", text },
      idempotencyKey: `digest:ad:${week}:${admin.id}`,
    });
  }

  return admins.length;
}

async function warnExpiringCertificates(): Promise<number> {
  const expiring = await expiringCertificates(COI_WARNING_DAYS);
  if (expiring.length === 0) return 0;

  await notifyAdmins(
    `${expiring.length} certificate(s) of insurance expiring within ${COI_WARNING_DAYS} days`,
    expiring
      .map(
        (doc) =>
          `${doc.booking?.organization?.name ?? doc.booking?.requester.name ?? "Unattached"} — expires ${doc.expiresAt?.toDateString()}`,
      )
      .join("\n") +
      "\n\nBookings will not confirm on an expired certificate.",
    `coi-expiry:${new Date().toISOString().slice(0, 10)}`,
  );

  const missing = await staffMissingAgreements();
  if (missing.length > 0) {
    await notifyAdmins(
      `${missing.length} coaching account(s) cannot book`,
      missing.map((u) => `${u.name} (${u.email})`).join("\n") +
        "\n\nThese accounts have no current Annual Coach Agreement on file.",
      `agreements-missing:${new Date().toISOString().slice(0, 10)}`,
    );
  }

  return expiring.length;
}

/**
 * A Stripe authorisation lapses after about a week, so an unresolved deposit is
 * a deadline. Nag until someone releases or captures it.
 */
async function nudgeUnresolvedDeposits(): Promise<number> {
  const pending = await depositsAwaitingResolution();
  if (pending.length === 0) return 0;

  await notifyAdmins(
    `${pending.length} security deposit(s) still held after the rental`,
    pending
      .map(
        (invoice) =>
          `${invoice.booking.title} (${invoice.booking.reference}) — ` +
          `${formatMoney(invoice.depositCents)} held since ` +
          `${invoice.booking.endAt.toDateString()}, ${invoice.booking.requester.name}\n` +
          `  ${env.appUrl}/portal/invoices/${invoice.id}`,
      )
      .join("\n\n") +
      "\n\nRelease or capture each one. Stripe authorisations expire on their own after about " +
      "seven days, which releases the funds without a decision being recorded.",
    `deposits-unresolved:${new Date().toISOString().slice(0, 10)}`,
  );

  return pending.length;
}

async function sendPaymentReminders(): Promise<number> {
  const invoices = await invoicesNeedingReminder();
  let sent = 0;

  for (const invoice of invoices) {
    if (!invoice.dueAt) continue;
    const daysOut = Math.ceil((invoice.dueAt.getTime() - Date.now()) / 86_400_000);
    // T-5 and T-2, as specified.
    if (daysOut !== 5 && daysOut !== 2) continue;

    await enqueue({
      kind: "invoice.reminder",
      payload: {
        to: invoice.booking.requester.email,
        subject: `Payment due in ${daysOut} days — ${invoice.number}`,
        text:
          `${invoice.booking.requester.name},\n\n` +
          `${formatMoney(invoice.totalCents)} is due for ${invoice.booking.title} by ` +
          `${invoice.dueAt.toDateString()}.\n\n` +
          `Pay here: ${env.appUrl}/portal/invoices/${invoice.id}\n\n` +
          "If payment is not received, the hold on your slot is released and the time returns to " +
          "open inventory.",
      },
      idempotencyKey: `reminder:${invoice.id}:t-${daysOut}`,
    });
    sent += 1;
  }

  return sent;
}
