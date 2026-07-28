import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { instantToLocalDate, instantToLocalTime, shiftISODate, startOfLocalDay } from "@/lib/time";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";

export const metadata: Metadata = { title: "Calendar" };

const VISIBLE_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

interface SearchParams {
  from?: string;
  days?: string;
  facility?: string;
  activity?: string;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const fromISO = params.from ?? instantToLocalDate(new Date());
  const days = Math.min(Math.max(Number(params.days ?? 7), 1), 31);
  const from = startOfLocalDay(fromISO);
  const to = startOfLocalDay(shiftISODate(fromISO, days));

  const facilities = await prisma.facility.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  const bookings = await prisma.booking.findMany({
    where: {
      startAt: { gte: from, lt: to },
      status: { in: VISIBLE_STATUSES },
      ...(params.facility ? { subSpace: { facilityId: params.facility } } : {}),
      ...(params.activity ? { activityType: params.activity as never } : {}),
    },
    include: {
      subSpace: { include: { facility: true } },
      requester: true,
      sport: true,
      organization: true,
    },
    orderBy: [{ startAt: "asc" }],
  });

  // Group by local day so a booking that crosses midnight in UTC still lands on
  // the right calendar day for the people reading it.
  const byDay = new Map<string, typeof bookings>();
  for (let i = 0; i < days; i++) byDay.set(shiftISODate(fromISO, i), []);
  for (const booking of bookings) {
    const key = instantToLocalDate(booking.startAt);
    const list = byDay.get(key);
    if (list) list.push(booking);
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Facility calendar"
        description="Everything holding a space, across every facility. Only confirmed bookings appear on the Google calendars."
        action={<LinkButton href="/book">Book a space</LinkButton>}
      />

      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">From</span>
            <input
              type="date"
              name="from"
              defaultValue={fromISO}
              className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Days</span>
            <select
              name="days"
              defaultValue={String(days)}
              className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
            >
              <option value="1">Day</option>
              <option value="7">Week</option>
              <option value="31">Month</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Facility</span>
            <select
              name="facility"
              defaultValue={params.facility ?? ""}
              className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
            >
              <option value="">All facilities</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Activity</span>
            <select
              name="activity"
              defaultValue={params.activity ?? ""}
              className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
            >
              <option value="">All activity types</option>
              {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
            >
              Apply filters
            </button>
          </div>
        </form>
      </Card>

      <div className="space-y-4">
        {[...byDay.entries()].map(([dateISO, dayBookings]) => (
          <Card
            key={dateISO}
            title={new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${dateISO}T12:00:00Z`))}
            description={`${dayBookings.length} booking${dayBookings.length === 1 ? "" : "s"}`}
          >
            {dayBookings.length === 0 ? (
              <EmptyState title="Nothing booked">
                The whole day is open inventory.{" "}
                <Link href={`/book?date=${dateISO}`} className="underline">
                  Book it
                </Link>
                .
              </EmptyState>
            ) : (
              <ul className="divide-y divide-navy-100">
                {dayBookings.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2.5">
                    <div className="w-28 shrink-0 font-mono text-sm text-navy-700">
                      {instantToLocalTime(booking.startAt)}–{instantToLocalTime(booking.endAt)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/portal/bookings/${booking.id}`}
                        className="font-medium text-navy-900 hover:underline"
                      >
                        {booking.title}
                      </Link>
                      <p className="text-sm text-navy-600">
                        {booking.subSpace.facility.name} — {booking.subSpace.name}
                        {booking.sport ? ` · ${booking.sport.name}` : ""}
                        {booking.organization && booking.organization.type !== "INTERNAL"
                          ? ` · ${booking.organization.name}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{ACTIVITY_LABELS[booking.activityType]}</Badge>
                      <StatusBadge status={booking.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
