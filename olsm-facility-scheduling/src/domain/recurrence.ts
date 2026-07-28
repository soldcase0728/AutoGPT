/**
 * RRULE expansion for standing blocks.
 *
 * Standing blocks are stored as an RRULE plus local wall-clock start/end times
 * ("15:30" - "17:30"). Expansion produces absolute instants, and each occurrence
 * is built by combining the occurrence's *local date* with the block's local
 * time. That is what keeps a 3:30 PM practice at 3:30 PM across the March DST
 * change instead of drifting to 2:30 PM.
 */

import { RRule, rrulestr } from "rrule";
import { localToInstant, SCHOOL_TZ, shiftISODate } from "@/lib/time";

export interface Occurrence {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  startAt: Date;
  endAt: Date;
}

export interface ExpandInput {
  rrule: string;
  /** Local times, "HH:MM". endTime <= startTime means the block crosses midnight. */
  startTime: string;
  endTime: string;
  /** Inclusive local date bounds, "YYYY-MM-DD". */
  fromDate: string;
  toDate: string;
  timeZone?: string;
  /** Local dates to skip, e.g. school holidays or released blocks. */
  excludeDates?: readonly string[];
  maxOccurrences?: number;
}

const DEFAULT_MAX = 500;

export function expandRecurrence(input: ExpandInput): Occurrence[] {
  const tz = input.timeZone ?? SCHOOL_TZ;
  const exclude = new Set(input.excludeDates ?? []);
  const max = input.maxOccurrences ?? DEFAULT_MAX;

  // The rrule library works in floating UTC here on purpose: we only want the
  // sequence of calendar dates. Times are attached afterwards in local terms.
  const [fy, fm, fd] = input.fromDate.split("-").map(Number);
  const [ty, tm, td] = input.toDate.split("-").map(Number);
  const dtstart = new Date(Date.UTC(fy, fm - 1, fd, 12, 0, 0));
  // End of the last day, not noon: a season ending on a Friday must include
  // that Friday's occurrence.
  const until = new Date(Date.UTC(ty, tm - 1, td, 23, 59, 59));

  const rule = parseRule(input.rrule, dtstart, until);

  const dates = rule.between(
    new Date(Date.UTC(fy, fm - 1, fd, 0, 0, 0)),
    new Date(Date.UTC(ty, tm - 1, td, 23, 59, 59)),
    true,
  );

  const out: Occurrence[] = [];
  for (const d of dates) {
    if (out.length >= max) break;
    const dateISO = d.toISOString().slice(0, 10);
    if (exclude.has(dateISO)) continue;

    const startAt = localToInstant(dateISO, input.startTime, tz);
    const crossesMidnight = input.endTime <= input.startTime;
    const endDate = crossesMidnight ? shiftISODate(dateISO, 1) : dateISO;
    const endAt = localToInstant(endDate, input.endTime, tz);

    out.push({ date: dateISO, startAt, endAt });
  }

  return out;
}

function parseRule(rruleText: string, dtstart: Date, until: Date): RRule {
  const trimmed = rruleText.trim();
  const withPrefix = /^(RRULE:|DTSTART|FREQ=)/i.test(trimmed)
    ? trimmed.startsWith("FREQ=")
      ? `RRULE:${trimmed}`
      : trimmed
    : `RRULE:${trimmed}`;

  const parsed = rrulestr(withPrefix, { dtstart });
  const options = parsed instanceof RRule ? parsed.origOptions : { freq: RRule.WEEKLY };

  return new RRule({
    ...options,
    dtstart,
    // Always bound the expansion; an unbounded FREQ=DAILY would otherwise run
    // to the library's default horizon.
    until: options.until && options.until < until ? options.until : until,
  });
}

/** Human summary of an RRULE for the allocation UI. */
export function describeRecurrence(rruleText: string): string {
  try {
    const trimmed = rruleText.trim();
    const text = rrulestr(trimmed.startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`);
    return text instanceof RRule ? text.toText() : trimmed;
  } catch {
    return rruleText;
  }
}

/** Build the common "weekdays" rule the allocation builder offers by default. */
export function weekdayRule(days: readonly ("MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU")[]) {
  return `FREQ=WEEKLY;BYDAY=${days.join(",")}`;
}
