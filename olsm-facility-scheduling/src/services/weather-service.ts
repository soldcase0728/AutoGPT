/**
 * Weather cancellation.
 *
 * When the AD calls a field for weather, they are cancelling ten bookings at
 * once under time pressure, usually from a phone, and every one of those groups
 * is already on the road. So this is one action, not ten: preview what would be
 * cancelled, then cancel the lot with full refunds and an immediate SMS to
 * anyone who opted in.
 *
 * The cancellation window is always waived. A group cancelled by the school for
 * weather did nothing wrong, and charging them 50% because it happened inside
 * 72 hours would be indefensible.
 */

import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { endOfLocalDay, formatRange, startOfLocalDay } from "@/lib/time";
import { formatMoney } from "@/domain/pricing";
import { enqueue } from "./job-queue";
import { cancelBooking, type Actor } from "./booking-service";

export interface WeatherImpact {
  bookingId: string;
  reference: string;
  title: string;
  subSpaceName: string;
  startAt: Date;
  endAt: Date;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string | null;
  smsOptIn: boolean;
  paidCents: number;
}

const ACTIVE: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
];

/** What a weather call would hit, so the AD sees it before committing. */
export async function previewWeatherImpact(
  facilityId: string,
  dateISO: string,
): Promise<WeatherImpact[]> {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw new NotFoundError("Facility");

  const bookings = await prisma.booking.findMany({
    where: {
      subSpace: { facilityId },
      startAt: { gte: startOfLocalDay(dateISO), lt: endOfLocalDay(dateISO) },
      status: { in: ACTIVE },
    },
    include: { requester: true, subSpace: true, invoices: true },
    orderBy: { startAt: "asc" },
  });

  return bookings.map((booking) => {
    const paid = booking.invoices.find((i) => i.status === "PAID");
    return {
      bookingId: booking.id,
      reference: booking.reference,
      title: booking.title,
      subSpaceName: booking.subSpace.name,
      startAt: booking.startAt,
      endAt: booking.endAt,
      requesterName: booking.requester.name,
      requesterEmail: booking.requester.email,
      requesterPhone: booking.requester.phone,
      smsOptIn: booking.requester.smsOptIn,
      paidCents: paid ? paid.totalCents - paid.refundedCents : 0,
    };
  });
}

export interface WeatherResult {
  cancelled: number;
  failed: { reference: string; reason: string }[];
  refundedCents: number;
  smsSent: number;
  emailsSent: number;
}

export async function cancelForWeather(
  facilityId: string,
  dateISO: string,
  reason: string,
  actor: Actor,
): Promise<WeatherResult> {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw new NotFoundError("Facility");

  if (reason.trim().length < 5) {
    throw new ValidationError("Say what the conditions are — it goes out to every group.");
  }

  const impacted = await previewWeatherImpact(facilityId, dateISO);
  if (impacted.length === 0) {
    throw new ValidationError("Nothing is booked at that facility on that date.");
  }

  const result: WeatherResult = {
    cancelled: 0,
    failed: [],
    refundedCents: 0,
    smsSent: 0,
    emailsSent: 0,
  };

  for (const impact of impacted) {
    try {
      // waiveCancellationPolicy: cancelled by the school, so refunded in full
      // regardless of how close to the start time it is.
      const outcome = await cancelBooking(
        impact.bookingId,
        `Weather cancellation: ${reason}`,
        actor,
        { waiveCancellationPolicy: true },
      );

      result.cancelled += 1;
      result.refundedCents += outcome.refundCents;

      const refundLine =
        outcome.refundCents > 0
          ? `\n\nA full refund of ${formatMoney(outcome.refundCents)} has been issued.`
          : "";

      await enqueue({
        kind: "notify.email",
        payload: {
          to: impact.requesterEmail,
          subject: `Cancelled for weather: ${impact.title}`,
          text:
            `${impact.requesterName},\n\n` +
            `${facility.name} is closed for ${formatRange(impact.startAt, impact.endAt)}.\n\n` +
            `Conditions: ${reason}${refundLine}\n\n` +
            "Please let your group know. The athletic office can help you find another time.",
        },
        idempotencyKey: `weather:email:${impact.bookingId}:${dateISO}`,
      });
      result.emailsSent += 1;

      // SMS is the point of this feature: people are already driving.
      if (impact.smsOptIn && impact.requesterPhone) {
        await enqueue({
          kind: "notify.sms",
          payload: {
            to: impact.requesterPhone,
            body:
              `OLSM: ${facility.name} is CLOSED for weather — ${impact.title}, ` +
              `${formatRange(impact.startAt, impact.endAt)} is cancelled. ${reason}`,
          },
          idempotencyKey: `weather:sms:${impact.bookingId}:${dateISO}`,
        });
        result.smsSent += 1;
      }
    } catch (error) {
      // One stuck booking must not stop the rest of the field being cleared.
      result.failed.push({
        reference: impact.reference,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordAudit({
    entityType: "facility",
    entityId: facilityId,
    action: "weather.cancelled_day",
    actorId: actor.id,
    actorLabel: actor.name,
    reason,
    ipAddress: actor.ipAddress,
    payload: {
      date: dateISO,
      cancelled: result.cancelled,
      failed: result.failed.length,
      refundedCents: result.refundedCents,
      smsSent: result.smsSent,
      references: impacted.map((i) => i.reference),
    },
  });

  return result;
}

/** Facilities a weather call can apply to. */
export async function weatherDependentFacilities() {
  return prisma.facility.findMany({
    where: { active: true, weatherDependent: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
