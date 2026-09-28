/**
 * One way to print a date or time for students and staff. Always in the
 * school's time zone and in en-US, so the server and the browser print the
 * same string: printing with the runtime's own locale or zone made the server
 * and the phone disagree (React error #418) and made times flicker.
 */

export const SCHOOL_TIME_ZONE = "America/Detroit";

/**
 * A bare calendar date ("2026-09-27") is that day at school, not UTC midnight
 * (which is the evening before in Detroit). Read it as midday UTC, which is
 * morning of the same day at school.
 */
function instant(value: Date | string): Date {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
}

/** "Sunday, September 27" */
export function dayLabel(value: Date | string): string {
  return instant(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: SCHOOL_TIME_ZONE,
  });
}

/** "9/27/2026" */
export function shortDate(value: Date | string): string {
  return instant(value).toLocaleDateString("en-US", { timeZone: SCHOOL_TIME_ZONE });
}

/** "Sep 27, 5:21 PM" */
export function dateTime(value: Date | string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SCHOOL_TIME_ZONE,
  });
}

/**
 * The hour (school time) a day's shot has to be sent by to count for that day:
 * 9:00 pm. Every "today", the evening rollover and the streak use this.
 */
export const DAY_CUTOFF_HOUR = 21;

function schoolParts(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Today's date at school, "2026-09-27", whatever zone the server or phone is in. */
export function schoolToday(now: Date | string = new Date()): string {
  const { year, month, day } = schoolParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The hour at school right now, 0–23. */
export function schoolHour(now: Date | string = new Date()): number {
  return schoolParts(now).hour;
}

/** The moment `day`'s shot stops counting: 9:00 pm school time that day. */
export function cutoffFor(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, DAY_CUTOFF_HOUR);
  const p = schoolParts(new Date(guess));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  return new Date(guess - offset);
}

/** True while `day`'s shot can still be sent in time. */
export function beforeCutoff(day: string, now: Date | string = new Date()): boolean {
  return new Date(now).getTime() < cutoffFor(day).getTime();
}
