/**
 * Time helpers.
 *
 * Everything persisted is an absolute instant (timestamptz). Everything a coach
 * types is wall-clock time in the school's timezone. These functions are the
 * only place the two are converted, so DST transitions are handled in one spot:
 * a 3:30 PM practice stays 3:30 PM local on both sides of the March change.
 */

import { env } from "./env";

export const SCHOOL_TZ = env.timezone || "America/Detroit";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** Offset in minutes between the given instant's local time and UTC. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  // Format the instant in the target zone, reinterpret those fields as UTC,
  // and the difference is the offset.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Convert a local wall-clock date/time in the school timezone to an instant.
 * `dateISO` is "YYYY-MM-DD", `time` is "HH:MM".
 */
export function localToInstant(dateISO: string, time: string, timeZone = SCHOOL_TZ): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid local datetime: ${dateISO} ${time}`);
  }
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  // First guess with the offset at the naive instant, then correct once. Two
  // passes is enough for every real-world zone, including DST boundaries.
  let guess = new Date(naiveUtc - tzOffsetMinutes(new Date(naiveUtc), timeZone) * 60_000);
  const offset2 = tzOffsetMinutes(guess, timeZone);
  guess = new Date(naiveUtc - offset2 * 60_000);
  return guess;
}

/** "YYYY-MM-DD" for an instant, in the school timezone. */
export function instantToLocalDate(instant: Date, timeZone = SCHOOL_TZ): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(instant);
}

/** "HH:MM" (24h) for an instant, in the school timezone. */
export function instantToLocalTime(instant: Date, timeZone = SCHOOL_TZ): string {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return dtf.format(instant);
}

export function weekdayKey(instant: Date, timeZone = SCHOOL_TZ): WeekdayKey {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const short = dtf.format(instant).toLowerCase().slice(0, 3);
  return (WEEKDAY_KEYS.find((k) => k === short) ?? "mon") as WeekdayKey;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

export function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 3_600_000;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  // Half-open [start, end) so back-to-back slots do not overlap.
  return aStart < bEnd && bStart < aEnd;
}

/** Human formatting for emails, calendar summaries and the UI. */
export function formatRange(start: Date, end: Date, timeZone = SCHOOL_TZ): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day}, ${t(start)}–${t(end)}`;
}

export function formatDateTime(instant: Date, timeZone = SCHOOL_TZ): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

export function startOfLocalDay(dateISO: string, timeZone = SCHOOL_TZ): Date {
  return localToInstant(dateISO, "00:00", timeZone);
}

export function endOfLocalDay(dateISO: string, timeZone = SCHOOL_TZ): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return startOfLocalDay(next.toISOString().slice(0, 10), timeZone);
}

/**
 * Format a date-only column ("@db.Date", stored at UTC midnight) as
 * "YYYY-MM-DD".
 *
 * Deliberately NOT `instantToLocalDate`: a season's start date is a calendar
 * date, not an instant. Converting UTC midnight into America/Detroit lands on
 * the previous evening and shifts the whole season back a day.
 */
export function dateColumnToISO(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** ISO date string N days from an ISO date string. */
export function shiftISODate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
