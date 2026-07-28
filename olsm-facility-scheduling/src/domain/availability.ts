/**
 * Operating hours and blackout checks.
 *
 * These are advisory in the sense that an admin can override them; the
 * exclusion constraint is not. A coach hitting a closed-hours error gets a
 * message, an admin gets a confirm-and-override.
 */

import { instantToLocalDate, instantToLocalTime, weekdayKey, type WeekdayKey } from "@/lib/time";

export interface OpenWindow {
  open: string; // "06:00"
  close: string; // "22:00"
}

export type DefaultHours = Partial<Record<WeekdayKey, OpenWindow[]>>;

export interface AvailabilityIssue {
  code: "CLOSED" | "OUTSIDE_HOURS" | "BLACKOUT" | "PAST" | "TOO_LONG";
  message: string;
  overridable: boolean;
}

export interface BlackoutWindow {
  startAt: Date;
  endAt: Date;
  reason: string;
}

const MAX_BOOKING_HOURS = 14;

export function parseDefaultHours(raw: unknown): DefaultHours {
  if (!raw || typeof raw !== "object") return {};
  return raw as DefaultHours;
}

/**
 * A booking must fall inside a single open window on its start day. Blocks that
 * cross midnight (rare, but the crew house and lock-ins do it) are checked
 * against the start day's window with the close time treated as end-of-day.
 */
export function checkOperatingHours(
  startAt: Date,
  endAt: Date,
  hours: DefaultHours,
  timeZone?: string,
): AvailabilityIssue | null {
  const day = weekdayKey(startAt, timeZone);
  const windows = hours[day];

  if (!windows || windows.length === 0) {
    return {
      code: "CLOSED",
      message: `This facility has no published hours on ${dayName(day)}.`,
      overridable: true,
    };
  }

  const start = instantToLocalTime(startAt, timeZone);
  const sameDay = instantToLocalDate(startAt, timeZone) === instantToLocalDate(endAt, timeZone);
  const end = sameDay ? instantToLocalTime(endAt, timeZone) : "24:00";

  const fits = windows.some((w) => start >= w.open && end <= w.close);
  if (fits) return null;

  const list = windows.map((w) => `${w.open}–${w.close}`).join(", ");
  return {
    code: "OUTSIDE_HOURS",
    message: `Requested ${start}–${end} is outside published hours on ${dayName(day)} (${list}).`,
    overridable: true,
  };
}

export function checkBlackouts(
  startAt: Date,
  endAt: Date,
  blackouts: readonly BlackoutWindow[],
): AvailabilityIssue | null {
  const hit = blackouts.find((b) => startAt < b.endAt && b.startAt < endAt);
  if (!hit) return null;
  return {
    code: "BLACKOUT",
    message: `This space is unavailable during the requested window: ${hit.reason}.`,
    overridable: true,
  };
}

export function checkSanity(startAt: Date, endAt: Date, now: Date = new Date()): AvailabilityIssue[] {
  const issues: AvailabilityIssue[] = [];
  if (endAt <= startAt) {
    issues.push({
      code: "TOO_LONG",
      message: "The end time must be after the start time.",
      overridable: false,
    });
    return issues;
  }
  if (startAt < now) {
    issues.push({
      code: "PAST",
      message: "That start time is in the past.",
      overridable: true,
    });
  }
  if ((endAt.getTime() - startAt.getTime()) / 3_600_000 > MAX_BOOKING_HOURS) {
    issues.push({
      code: "TOO_LONG",
      message: `A single booking may not exceed ${MAX_BOOKING_HOURS} hours. Use a recurring booking instead.`,
      overridable: true,
    });
  }
  return issues;
}

const DAY_NAMES: Record<WeekdayKey, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

export function dayName(key: WeekdayKey): string {
  return DAY_NAMES[key];
}

export const STANDARD_HOURS: DefaultHours = {
  mon: [{ open: "06:00", close: "22:00" }],
  tue: [{ open: "06:00", close: "22:00" }],
  wed: [{ open: "06:00", close: "22:00" }],
  thu: [{ open: "06:00", close: "22:00" }],
  fri: [{ open: "06:00", close: "22:00" }],
  sat: [{ open: "07:00", close: "21:00" }],
  sun: [{ open: "12:00", close: "20:00" }],
};
