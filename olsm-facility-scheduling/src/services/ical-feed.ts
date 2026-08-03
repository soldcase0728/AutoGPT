/**
 * Read-only iCal feeds, one per facility.
 *
 * This is the whole of the calendar integration now. A subscribed feed shows a
 * coach their schedule in Google Calendar, Outlook or their phone, and it
 * cannot drift out of step because it only flows one way. The two-way Google
 * push sync that used to live here bought write-back from the coach's calendar
 * into the booking record, which is not a thing anybody wanted, at the cost of
 * webhook channels that needed renewing and a sync status to explain.
 *
 * The URL is unauthenticated by design, so confirmed bookings only and no
 * requester contact details.
 */

import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SCHOOL_TZ, formatRange } from "@/lib/time";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";

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
