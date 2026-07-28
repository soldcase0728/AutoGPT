/**
 * Google Calendar sync. One way: the app writes, Google displays.
 *
 * The revert path is the interesting half. When someone edits an event in
 * Google Calendar, Google sends a change notification; we compare the event
 * against what we last wrote and, if it differs, write ours back over it and
 * tell the editor why. The alternative -- honouring the edit -- would mean a
 * confirmed, paid rental could be silently moved into a conflicting slot with
 * no contract and no re-check.
 */

import { BookingStatus, CalendarSyncStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { formatRange, SCHOOL_TZ } from "@/lib/time";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import {
  calendarConfigured,
  CalendarApiError,
  CalendarNotConfiguredError,
  createEvent,
  deleteEvent,
  eventMatchesExpected,
  getEvent,
  listChangedEvents,
  updateEvent,
  watchCalendar,
  type CalendarEventInput,
} from "@/integrations/calendar/google-calendar";
import { notifyAdmins, notifyCalendarEditReverted } from "./notification-service";
import { registerHandler } from "./job-queue";

/** Build the event payload from a booking. Single source for write and revert. */
export async function buildEventInput(bookingId: string): Promise<{
  input: CalendarEventInput;
  calendarId: string | null;
} | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      requester: true,
      organization: true,
      sport: true,
      subSpace: { include: { facility: true } },
    },
  });
  if (!booking) return null;

  const lines = [
    `Activity: ${ACTIVITY_LABELS[booking.activityType]}`,
    booking.sport ? `Sport: ${booking.sport.name}` : null,
    booking.organization ? `Organization: ${booking.organization.name}` : null,
    `Requester: ${booking.requester.name}${booking.requester.phone ? ` (${booking.requester.phone})` : ""}`,
    `Headcount: ${booking.headcount || "n/a"}`,
    `Space: ${booking.subSpace.name}`,
    booking.setupNotes ? `Setup: ${booking.setupNotes}` : null,
    booking.equipmentNotes ? `Equipment: ${booking.equipmentNotes}` : null,
    "",
    `Booking record: ${env.appUrl}/portal/bookings/${booking.id}`,
    `Reference: ${booking.reference}`,
    "",
    "Managed by the OLSM facility scheduling app. Edits made here are reverted —",
    "change the booking in the app instead.",
  ].filter(Boolean);

  return {
    calendarId: booking.subSpace.facility.googleCalendarId,
    input: {
      summary: `${booking.title} — ${booking.subSpace.name}`,
      description: lines.join("\n"),
      location: `${booking.subSpace.facility.name}, ${booking.subSpace.name}`,
      startAt: booking.startAt,
      endAt: booking.endAt,
      bookingId: booking.id,
      bookingReference: booking.reference,
      syncVersion: booking.calendarSyncVersion + 1,
    },
  };
}

/** Create or update the Google event for a confirmed booking. */
export async function syncBookingToCalendar(bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return;

  // Only CONFIRMED and CHECKED_IN belong on the calendar.
  if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.CHECKED_IN) {
    if (booking.googleEventId && booking.googleCalendarId) {
      await removeBookingFromCalendar(bookingId, booking.googleCalendarId, booking.googleEventId);
    }
    return;
  }

  const built = await buildEventInput(bookingId);
  if (!built) return;

  if (!built.calendarId) {
    await markSyncFailed(
      bookingId,
      "The facility has no Google Calendar configured. Set one in Admin > Facilities.",
    );
    return;
  }

  if (!calendarConfigured()) {
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        calendarSyncStatus: CalendarSyncStatus.FAILED,
        calendarSyncError: "Google Calendar is not configured in this environment.",
      },
    });
    return;
  }

  try {
    const event = booking.googleEventId
      ? await updateEvent(built.calendarId, booking.googleEventId, built.input)
      : await createEvent(built.calendarId, built.input);

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        googleEventId: event.id,
        googleCalendarId: built.calendarId,
        calendarSyncStatus: CalendarSyncStatus.SYNCED,
        calendarSyncError: null,
        calendarSyncVersion: built.input.syncVersion,
      },
    });

    await recordAudit({
      entityType: "booking",
      entityId: bookingId,
      action: "calendar.synced",
      actorLabel: "system",
      payload: { calendarId: built.calendarId, eventId: event.id, syncVersion: built.input.syncVersion },
    });
  } catch (error) {
    if (error instanceof CalendarNotConfiguredError) return;
    const message = error instanceof Error ? error.message : String(error);
    await markSyncFailed(bookingId, message);
    // Retryable errors are re-thrown so the job queue backs off and tries again.
    if (error instanceof CalendarApiError && error.retryable) throw error;
    if (!(error instanceof CalendarApiError)) throw error;
  }
}

export async function removeBookingFromCalendar(
  bookingId: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  if (!calendarConfigured()) return;

  await deleteEvent(calendarId, eventId);
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      googleEventId: null,
      calendarSyncStatus: CalendarSyncStatus.DELETED,
      calendarSyncError: null,
    },
  });

  await recordAudit({
    entityType: "booking",
    entityId: bookingId,
    action: "calendar.deleted",
    actorLabel: "system",
    payload: { calendarId, eventId },
  });
}

async function markSyncFailed(bookingId: string, message: string): Promise<void> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      calendarSyncStatus: CalendarSyncStatus.FAILED,
      calendarSyncError: message.slice(0, 500),
    },
  });

  await recordAudit({
    entityType: "booking",
    entityId: bookingId,
    action: "calendar.sync_failed",
    actorLabel: "system",
    reason: message.slice(0, 500),
  });

  // Never fail silently.
  await notifyAdmins(
    "Calendar sync failed",
    `A booking could not be written to Google Calendar.\n\n${message}\n\n${env.appUrl}/admin/bookings/${bookingId}`,
    `calendar-fail:${bookingId}`,
  );
}

export interface RevertOutcome {
  checked: number;
  reverted: number;
  details: { bookingId: string; differences: string[] }[];
}

/**
 * Process a change notification for one facility calendar: find events that no
 * longer match what we wrote and put them back.
 */
export async function reconcileCalendar(facilityId: string): Promise<RevertOutcome> {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  const outcome: RevertOutcome = { checked: 0, reverted: 0, details: [] };
  if (!facility?.googleCalendarId || !calendarConfigured()) return outcome;

  const { events } = await listChangedEvents(facility.googleCalendarId);

  for (const event of events) {
    const bookingId = event.extendedProperties?.private?.olsmBookingId;
    if (!bookingId) continue; // Not ours; leave it alone.

    outcome.checked += 1;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { requester: true },
    });
    if (!booking) continue;

    const built = await buildEventInput(bookingId);
    if (!built) continue;

    // Compare against the version we last wrote, not the incremented one.
    const expected = { ...built.input, syncVersion: booking.calendarSyncVersion };
    const { matches, differences } = eventMatchesExpected(event, expected);
    if (matches) continue;

    // A booking that should no longer be on the calendar: honour the deletion.
    const shouldExist =
      booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.CHECKED_IN;
    if (!shouldExist) continue;

    await revertCalendarEdit(bookingId, differences, event.id);
    outcome.reverted += 1;
    outcome.details.push({ bookingId, differences });
  }

  return outcome;
}

export async function revertCalendarEdit(
  bookingId: string,
  differences: string[],
  eventId: string,
): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { requester: true },
  });
  if (!booking || !booking.googleCalendarId) return;

  const built = await buildEventInput(bookingId);
  if (!built || !built.calendarId) return;

  // Re-writing the whole event body puts every field back, including a
  // deletion (a cancelled event is restored by a PUT).
  const restored = differences.includes("deletion")
    ? await createEvent(built.calendarId, built.input)
    : await updateEvent(built.calendarId, eventId, built.input);

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      googleEventId: restored.id,
      calendarSyncVersion: built.input.syncVersion,
      calendarSyncStatus: CalendarSyncStatus.SYNCED,
    },
  });

  await recordAudit({
    entityType: "booking",
    entityId: bookingId,
    action: "calendar.edit_reverted",
    actorLabel: "system",
    reason: `Changed in Google Calendar (${differences.join(", ")}); reverted to the app's record.`,
    payload: { differences, eventId },
  });

  // Google does not tell us who made the edit in the change feed, so the
  // notification goes to the booking owner, who is the person most likely to
  // have moved it and the person who needs to know it did not take.
  await notifyCalendarEditReverted({
    editorEmail: booking.requester.email,
    bookingReference: booking.reference,
    bookingTitle: booking.title,
    bookingId,
    differences,
  });
}

/** (Re)subscribe every facility calendar to push notifications. */
export async function refreshWatchChannels(): Promise<number> {
  if (!calendarConfigured() || !env.google.calendarWebhookToken) return 0;

  const facilities = await prisma.facility.findMany({
    where: { active: true, googleCalendarId: { not: null } },
  });

  let refreshed = 0;
  const soon = new Date(Date.now() + 86_400_000);

  for (const facility of facilities) {
    if (facility.googleChannelExpiry && facility.googleChannelExpiry > soon) continue;

    const channelId = `olsm-${facility.slug}-${Date.now()}`;
    try {
      const channel = await watchCalendar(
        facility.googleCalendarId!,
        channelId,
        `${env.appUrl}/api/webhooks/google-calendar`,
        env.google.calendarWebhookToken,
      );
      await prisma.facility.update({
        where: { id: facility.id },
        data: {
          googleChannelId: channel.id,
          googleResourceId: channel.resourceId,
          googleChannelExpiry: channel.expiration ? new Date(Number(channel.expiration)) : null,
        },
      });
      refreshed += 1;
    } catch (error) {
      await notifyAdmins(
        "Calendar watch channel failed",
        `Could not subscribe to changes on ${facility.name}: ${error instanceof Error ? error.message : error}`,
        `watch-fail:${facility.id}`,
      );
    }
  }

  return refreshed;
}

/**
 * Read-only iCal feed for a facility, for people who are not on Google
 * Workspace and for the public website.
 */
export async function buildIcsFeed(facilitySlug: string): Promise<string | null> {
  const facility = await prisma.facility.findUnique({
    where: { slug: facilitySlug },
    include: {
      subSpaces: {
        include: {
          bookings: {
            where: {
              status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
              endAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
            },
            include: { sport: true },
          },
        },
      },
    },
  });
  if (!facility) return null;

  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const escape = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orchard Lake St Marys//Facility Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(facility.name)}`,
    `X-WR-TIMEZONE:${SCHOOL_TZ}`,
  ];

  for (const subSpace of facility.subSpaces) {
    for (const booking of subSpace.bookings) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${booking.id}@olsm-facilities`,
        `DTSTAMP:${stamp(booking.updatedAt)}`,
        `DTSTART:${stamp(booking.startAt)}`,
        `DTEND:${stamp(booking.endAt)}`,
        `SUMMARY:${escape(`${booking.title} — ${subSpace.name}`)}`,
        `LOCATION:${escape(`${facility.name}, ${subSpace.name}`)}`,
        `DESCRIPTION:${escape(
          `${ACTIVITY_LABELS[booking.activityType]}${booking.sport ? ` — ${booking.sport.name}` : ""}\n${formatRange(booking.startAt, booking.endAt)}`,
        )}`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
      );
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Wire the calendar jobs into the queue. Called from the job route. */
export function registerCalendarHandlers(): void {
  registerHandler("calendar.upsert", async (payload) => {
    await syncBookingToCalendar(String(payload.bookingId));
  });

  registerHandler("calendar.delete", async (payload) => {
    const calendarId = payload.calendarId ? String(payload.calendarId) : null;
    const eventId = payload.eventId ? String(payload.eventId) : null;
    if (!calendarId || !eventId) return;
    await removeBookingFromCalendar(String(payload.bookingId), calendarId, eventId);
  });

  registerHandler("calendar.revert", async (payload) => {
    await reconcileCalendar(String(payload.facilityId));
  });
}

export { getEvent };
