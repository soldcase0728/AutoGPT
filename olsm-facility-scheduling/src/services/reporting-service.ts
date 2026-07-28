/**
 * Reporting.
 *
 * The headline number is revenue captured from non-team use, broken down by
 * facility, activity type and organisation -- that is the metric the whole
 * project is justified by, so it gets a first-class query rather than being
 * assembled in the UI.
 */

import { ActivityType, BookingStatus, InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hoursBetween } from "@/lib/time";

/** Activity types that represent non-team use -- the revenue opportunity. */
export const NON_TEAM_ACTIVITY_TYPES: readonly ActivityType[] = [
  ActivityType.PRIVATE_INSTRUCTION,
  ActivityType.CLUB_TRAVEL,
  ActivityType.EXTERNAL_RENTAL,
  ActivityType.SCHOOL_CAMP,
];

export interface DateRange {
  from: Date;
  to: Date;
}

export interface RevenueRow {
  key: string;
  label: string;
  bookings: number;
  grossCents: number;
  refundedCents: number;
  netCents: number;
}

export interface RevenueReport {
  byFacility: RevenueRow[];
  byActivityType: RevenueRow[];
  byOrganization: RevenueRow[];
  totalNetCents: number;
  nonTeamNetCents: number;
  range: DateRange;
}

export async function revenueReport(range: DateRange): Promise<RevenueReport> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_REFUNDED, InvoiceStatus.REFUNDED] },
      booking: { startAt: { gte: range.from, lt: range.to } },
    },
    include: {
      booking: {
        include: {
          organization: true,
          subSpace: { include: { facility: true } },
        },
      },
    },
  });

  const facility = new Map<string, RevenueRow>();
  const activity = new Map<string, RevenueRow>();
  const organization = new Map<string, RevenueRow>();

  let totalNet = 0;
  let nonTeamNet = 0;

  for (const invoice of invoices) {
    const net = invoice.totalCents - invoice.refundedCents;
    totalNet += net;
    if (NON_TEAM_ACTIVITY_TYPES.includes(invoice.booking.activityType)) nonTeamNet += net;

    accumulate(facility, invoice.booking.subSpace.facilityId, invoice.booking.subSpace.facility.name, invoice.totalCents, invoice.refundedCents);
    accumulate(activity, invoice.booking.activityType, invoice.booking.activityType, invoice.totalCents, invoice.refundedCents);
    accumulate(
      organization,
      invoice.booking.organizationId ?? "internal",
      invoice.booking.organization?.name ?? "Internal / no organization",
      invoice.totalCents,
      invoice.refundedCents,
    );
  }

  const sort = (m: Map<string, RevenueRow>) =>
    [...m.values()].sort((a, b) => b.netCents - a.netCents);

  return {
    byFacility: sort(facility),
    byActivityType: sort(activity),
    byOrganization: sort(organization),
    totalNetCents: totalNet,
    nonTeamNetCents: nonTeamNet,
    range,
  };
}

function accumulate(
  map: Map<string, RevenueRow>,
  key: string,
  label: string,
  grossCents: number,
  refundedCents: number,
): void {
  const row = map.get(key) ?? { key, label, bookings: 0, grossCents: 0, refundedCents: 0, netCents: 0 };
  row.bookings += 1;
  row.grossCents += grossCents;
  row.refundedCents += refundedCents;
  row.netCents += grossCents - refundedCents;
  map.set(key, row);
}

export interface UtilizationRow {
  facilityId: string;
  facilityName: string;
  bookedHours: number;
  bookings: number;
  /** Booked hours as a share of published open hours in the range. */
  utilizationPercent: number;
}

export async function utilizationReport(range: DateRange): Promise<UtilizationRow[]> {
  const bookings = await prisma.booking.findMany({
    where: {
      startAt: { gte: range.from, lt: range.to },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] },
    },
    include: { subSpace: { include: { facility: true } } },
  });

  const days = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / 86_400_000));
  const rows = new Map<string, UtilizationRow>();

  for (const booking of bookings) {
    const facility = booking.subSpace.facility;
    const row = rows.get(facility.id) ?? {
      facilityId: facility.id,
      facilityName: facility.name,
      bookedHours: 0,
      bookings: 0,
      utilizationPercent: 0,
    };
    row.bookedHours += hoursBetween(booking.startAt, booking.endAt);
    row.bookings += 1;
    rows.set(facility.id, row);
  }

  // Denominator: published open hours per day, averaged. A facility open
  // 06:00-22:00 has 16 available hours a day.
  const facilities = await prisma.facility.findMany({ where: { active: true } });
  for (const facility of facilities) {
    const row = rows.get(facility.id);
    if (!row) continue;
    const openHoursPerDay = averageOpenHours(facility.defaultHours);
    const available = openHoursPerDay * days;
    row.utilizationPercent = available > 0 ? Math.round((row.bookedHours / available) * 100) : 0;
  }

  return [...rows.values()].sort((a, b) => b.bookedHours - a.bookedHours);
}

/** Bookings by hour of day, for the "when are we actually busy" heat map. */
export async function timeOfDayHistogram(range: DateRange): Promise<{ hour: number; count: number }[]> {
  const rows = await prisma.$queryRaw<{ hour: number; count: bigint }[]>`
    SELECT EXTRACT(HOUR FROM start_at AT TIME ZONE 'America/Detroit')::int AS hour,
           COUNT(*)::bigint AS count
    FROM bookings
    WHERE start_at >= ${range.from} AND start_at < ${range.to}
      AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((r) => ({ hour: r.hour, count: Number(r.count) }));
}

export interface OperationsSummary {
  pendingApprovals: number;
  awaitingDocuments: number;
  awaitingPayment: number;
  unpaidInvoiceCents: number;
  deniedLast30: number;
  bumpedLast30: number;
  noShowLast30: number;
  expiringCoiCount: number;
  unsignedAgreementCount: number;
  failedCalendarSyncs: number;
}

export async function operationsSummary(now: Date = new Date()): Promise<OperationsSummary> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const in30 = new Date(now.getTime() + 30 * 86_400_000);

  const [
    pendingApprovals,
    awaitingDocuments,
    awaitingPayment,
    unpaid,
    deniedLast30,
    bumpedLast30,
    noShowLast30,
    expiringCoiCount,
    failedCalendarSyncs,
  ] = await Promise.all([
    prisma.booking.count({ where: { status: BookingStatus.PENDING_APPROVAL } }),
    prisma.booking.count({ where: { status: BookingStatus.AWAITING_DOCUMENTS } }),
    prisma.booking.count({ where: { status: BookingStatus.AWAITING_PAYMENT } }),
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.ISSUED },
      _sum: { totalCents: true },
    }),
    prisma.booking.count({
      where: { status: BookingStatus.DENIED, updatedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.auditLog.count({
      where: { action: "booking.bumped", createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.booking.count({
      where: { status: BookingStatus.NO_SHOW, updatedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.document.count({
      where: {
        type: "CERTIFICATE_OF_INSURANCE",
        status: { in: ["UPLOADED", "SIGNED"] },
        expiresAt: { not: null, lte: in30, gte: now },
      },
    }),
    prisma.booking.count({ where: { calendarSyncStatus: "FAILED" } }),
  ]);

  const { staffMissingAgreements } = await import("./document-service");
  const missing = await staffMissingAgreements(now);

  return {
    pendingApprovals,
    awaitingDocuments,
    awaitingPayment,
    unpaidInvoiceCents: unpaid._sum.totalCents ?? 0,
    deniedLast30,
    bumpedLast30,
    noShowLast30,
    expiringCoiCount,
    unsignedAgreementCount: missing.length,
    failedCalendarSyncs,
  };
}

/** Today's and tomorrow's bookings for the custodial setup board. */
export async function setupBoard(from: Date, to: Date) {
  return prisma.booking.findMany({
    where: {
      startAt: { gte: from, lt: to },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
    },
    include: {
      subSpace: { include: { facility: true } },
      requester: true,
      sport: true,
      organization: true,
    },
    orderBy: [{ startAt: "asc" }],
  });
}

function averageOpenHours(defaultHours: unknown): number {
  if (!defaultHours || typeof defaultHours !== "object") return 0;
  const hours = defaultHours as Record<string, { open: string; close: string }[]>;
  const perDay = Object.values(hours).map((windows) =>
    (windows ?? []).reduce((sum, w) => sum + (toMinutes(w.close) - toMinutes(w.open)) / 60, 0),
  );
  if (perDay.length === 0) return 0;
  return perDay.reduce((a, b) => a + b, 0) / perDay.length;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
