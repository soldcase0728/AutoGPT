import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { canBookFacility } from "@/lib/auth/rbac";
import { AppShell } from "@/components/app-shell";
import { colorForSport, legendFor } from "@/domain/sport-colors";
import { SportLegend } from "./sport-legend";
import { Badge, Card, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import {
  instantToLocalDate,
  instantToLocalTime,
  SCHOOL_TZ,
  shiftISODate,
  startOfLocalDay,
} from "@/lib/time";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { parseDefaultHours } from "@/domain/availability";
import { gridBounds, minutesOfDay } from "@/domain/calendar-layout";
import { CalendarGrid, type GridColumn, type GridEvent } from "./calendar-grid";

export const metadata: Metadata = { title: "Calendar" };

const VISIBLE_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
];

/** Statuses that are holds rather than commitments; drawn differently. */
const PROVISIONAL: BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
];

type View = "day" | "week" | "month" | "agenda";

interface SearchParams {
  view?: string;
  from?: string;
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

  const view: View = (["day", "week", "month", "agenda"] as const).includes(params.view as View)
    ? (params.view as View)
    : "week";

  const todayISO = instantToLocalDate(new Date());
  const fromISO = params.from ?? todayISO;

  const facilities = await prisma.facility.findMany({
    where: { active: true },
    include: { subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });

  // Day view needs a facility to have columns worth showing.
  const facilityId = params.facility ?? (view === "day" ? facilities[0]?.id : undefined);
  const facility = facilities.find((f) => f.id === facilityId);

  const { rangeStartISO, days } = resolveRange(view, fromISO);
  const from = startOfLocalDay(rangeStartISO);
  const to = startOfLocalDay(shiftISODate(rangeStartISO, days));

  const bookings = await prisma.booking.findMany({
    where: {
      startAt: { gte: from, lt: to },
      status: { in: VISIBLE_STATUSES },
      ...(facilityId ? { subSpace: { facilityId } } : {}),
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

  const canCreate =
    user.role !== "FACILITIES" &&
    user.role !== "FINANCE" &&
    user.role !== "EXTERNAL" &&
    facilities.some((f) => canBookFacility({ role: user.role, facilityScope: user.facilityScope }, f));

  const filters = (
    <Card className="mb-5">
      <form method="get" className="grid gap-3 sm:grid-cols-5">
        <input type="hidden" name="view" value={view} />
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy-800">Date</span>
          <input
            type="date"
            name="from"
            defaultValue={fromISO}
            className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-navy-800">Facility</span>
          <select
            name="facility"
            defaultValue={facilityId ?? ""}
            className="w-full rounded-md border border-navy-300 px-3 py-2 text-sm"
          >
            {view !== "day" && <option value="">All facilities</option>}
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
            <option value="">All types</option>
            {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Apply
          </button>
        </div>
      </form>
    </Card>
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Facility calendar"
        description="Everything holding a space. Lighter, ringed blocks are held but not yet confirmed. Colour shows the sport; the key is next to the grid, or below it on a phone."
        action={<LinkButton href="/book">Book a space</LinkButton>}
      />

      <ViewSwitcher view={view} params={params} fromISO={fromISO} todayISO={todayISO} days={days} />
      {filters}

      {view === "agenda" ? (
        <AgendaView bookings={bookings} rangeStartISO={rangeStartISO} days={days} />
      ) : view === "month" ? (
        <MonthView bookings={bookings} rangeStartISO={rangeStartISO} days={days} />
      ) : (
        <Card
          title={view === "day" ? (facility?.name ?? "Day") : "Week"}
          description={
            view === "day"
              ? "Columns are the bookable spaces in this facility."
              : "Columns are days. Switch to the day view to see spaces side by side."
          }
        >
          {bookings.length === 0 && (
            <p className="mb-3 text-sm text-navy-600">
              Nothing booked in this range — the whole grid is open inventory.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
            <div className="min-w-0">
              <CalendarGrid
                {...buildGrid(view, bookings, facility, rangeStartISO, days)}
                canCreate={canCreate}
                dateISO={rangeStartISO}
              />
            </div>
            {/*
              Below the grid on a phone rather than beside it. A 13rem column
              next to a time grid on a 412px screen leaves neither readable.
            */}
            <SportLegend entries={legendFor(bookings)} />
          </div>
        </Card>
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function resolveRange(view: View, fromISO: string): { rangeStartISO: string; days: number } {
  if (view === "day") return { rangeStartISO: fromISO, days: 1 };

  if (view === "week") {
    // Start the week on Monday, which is how a school week reads.
    const d = new Date(`${fromISO}T12:00:00Z`);
    const offset = (d.getUTCDay() + 6) % 7;
    return { rangeStartISO: shiftISODate(fromISO, -offset), days: 7 };
  }

  if (view === "month") {
    const first = `${fromISO.slice(0, 7)}-01`;
    const [y, m] = first.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { rangeStartISO: first, days: daysInMonth };
  }

  return { rangeStartISO: fromISO, days: 14 };
}

type BookingRow = Prisma.BookingGetPayload<{
  include: {
    subSpace: { include: { facility: true } };
    requester: true;
    sport: true;
    organization: true;
  };
}>;

type FacilityWithSpaces = Prisma.FacilityGetPayload<{ include: { subSpaces: true } }>;

function buildGrid(
  view: View,
  bookings: BookingRow[],
  facility: FacilityWithSpaces | undefined,
  rangeStartISO: string,
  days: number,
): { columns: GridColumn[]; events: GridEvent[]; startMinutes: number; endMinutes: number } {
  const events: GridEvent[] = bookings.map((booking) => ({
    id: booking.id,
    title: booking.title,
    subtitle:
      view === "day"
        ? `${instantToLocalTime(booking.startAt)} · ${booking.requester.name}`
        : `${instantToLocalTime(booking.startAt)} · ${booking.subSpace.name}`,
    status: booking.status,
    activityType: booking.activityType,
    columnKey:
      view === "day" ? booking.subSpaceId : instantToLocalDate(booking.startAt, SCHOOL_TZ),
    href: `/portal/bookings/${booking.id}`,
    provisional: PROVISIONAL.includes(booking.status),
    ...(({ fill, ink }) => ({ fill, ink }))(colorForSport(booking.sport)),
    startMinutes: minutesOfDay(booking.startAt, SCHOOL_TZ),
    endMinutes: endMinutesFor(booking),
  }));

  const columns: GridColumn[] =
    view === "day"
      ? (facility?.subSpaces ?? []).map((sub) => ({
          key: sub.id,
          label: sub.name,
          subSpaceId: sub.id,
          dateISO: rangeStartISO,
        }))
      : Array.from({ length: days }, (_, i) => {
          const dateISO = shiftISODate(rangeStartISO, i);
          const d = new Date(`${dateISO}T12:00:00Z`);
          return {
            key: dateISO,
            label: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(d),
            sublabel: new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(d),
            dateISO,
          };
        });

  const hours = parseDefaultHours(facility?.defaultHours);
  const windows = Object.values(hours).flat().filter(Boolean) as { open: string; close: string }[];
  const open = windows.length > 0 ? toMinutes(windows[0].open) : 6 * 60;
  const close = windows.length > 0 ? toMinutes(windows[0].close) : 22 * 60;

  const bounds = gridBounds(events, open, close);
  return { columns, events, ...bounds };
}

/** A booking that runs past midnight is clipped to the day it started. */
function endMinutesFor(booking: BookingRow): number {
  const sameDay =
    instantToLocalDate(booking.startAt, SCHOOL_TZ) === instantToLocalDate(booking.endAt, SCHOOL_TZ);
  return sameDay ? minutesOfDay(booking.endAt, SCHOOL_TZ) : 24 * 60;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function ViewSwitcher({
  view,
  params,
  fromISO,
  todayISO,
  days,
}: {
  view: View;
  params: SearchParams;
  fromISO: string;
  todayISO: string;
  days: number;
}) {
  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    if (params.facility) next.set("facility", params.facility);
    if (params.activity) next.set("activity", params.activity);
    next.set("view", view);
    next.set("from", fromISO);
    for (const [k, v] of Object.entries(overrides)) next.set(k, v);
    return `/calendar?${next.toString()}`;
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-navy-300">
        {(["day", "week", "month", "agenda"] as const).map((v) => (
          <Link
            key={v}
            href={link({ view: v })}
            aria-current={view === v ? "page" : undefined}
            className={
              view === v
                ? "bg-navy-800 px-3 py-1.5 text-sm font-medium capitalize text-white"
                : "bg-white px-3 py-1.5 text-sm capitalize text-navy-700 hover:bg-navy-50"
            }
          >
            {v}
          </Link>
        ))}
      </div>

      <div className="flex gap-1">
        <Link
          href={link({ from: shiftISODate(fromISO, -days) })}
          className="rounded border border-navy-300 bg-white px-2.5 py-1.5 text-sm hover:bg-navy-50"
          aria-label="Previous period"
        >
          ←
        </Link>
        <Link
          href={link({ from: todayISO })}
          className="rounded border border-navy-300 bg-white px-3 py-1.5 text-sm hover:bg-navy-50"
        >
          Today
        </Link>
        <Link
          href={link({ from: shiftISODate(fromISO, days) })}
          className="rounded border border-navy-300 bg-white px-2.5 py-1.5 text-sm hover:bg-navy-50"
          aria-label="Next period"
        >
          →
        </Link>
      </div>
    </div>
  );
}

function MonthView({
  bookings,
  rangeStartISO,
  days,
}: {
  bookings: BookingRow[];
  rangeStartISO: string;
  days: number;
}) {
  const byDay = new Map<string, BookingRow[]>();
  for (let i = 0; i < days; i++) byDay.set(shiftISODate(rangeStartISO, i), []);
  for (const booking of bookings) {
    byDay.get(instantToLocalDate(booking.startAt, SCHOOL_TZ))?.push(booking);
  }

  // Pad so the first cell lands on the right weekday.
  const firstOffset = (new Date(`${rangeStartISO}T12:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <Card title="Month">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-navy-200 bg-navy-200 text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-navy-50 px-2 py-1 text-center font-semibold text-navy-700">
            {d}
          </div>
        ))}

        {Array.from({ length: firstOffset }, (_, i) => (
          <div key={`pad-${i}`} className="min-h-24 bg-navy-50" />
        ))}

        {[...byDay.entries()].map(([dateISO, list]) => (
          <div key={dateISO} className="min-h-24 bg-white p-1">
            <Link
              href={`/calendar?view=day&from=${dateISO}`}
              className="mb-1 block font-semibold text-navy-800 hover:underline"
            >
              {Number(dateISO.slice(-2))}
            </Link>
            <ul className="space-y-0.5">
              {list.slice(0, 3).map((booking) => (
                <li key={booking.id} className="truncate">
                  <Link href={`/portal/bookings/${booking.id}`} className="hover:underline">
                    <span className="text-navy-500">{instantToLocalTime(booking.startAt)}</span>{" "}
                    {booking.title}
                  </Link>
                </li>
              ))}
              {list.length > 3 && (
                <li className="text-navy-500">+{list.length - 3} more</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AgendaView({
  bookings,
  rangeStartISO,
  days,
}: {
  bookings: BookingRow[];
  rangeStartISO: string;
  days: number;
}) {
  const byDay = new Map<string, BookingRow[]>();
  for (let i = 0; i < days; i++) byDay.set(shiftISODate(rangeStartISO, i), []);
  for (const booking of bookings) {
    byDay.get(instantToLocalDate(booking.startAt, SCHOOL_TZ))?.push(booking);
  }

  return (
    <div className="space-y-4">
      {[...byDay.entries()].map(([dateISO, list]) => (
        <Card
          key={dateISO}
          title={new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${dateISO}T12:00:00Z`))}
          description={`${list.length} booking${list.length === 1 ? "" : "s"}`}
        >
          {list.length === 0 ? (
            <EmptyState title="Nothing booked">
              <Link href={`/book?date=${dateISO}`} className="underline">
                Book it
              </Link>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-navy-100">
              {list.map((booking) => (
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
  );
}
