/**
 * One way to print a date or time for students and staff. Always in the
 * school's time zone and in en-US, so the server and the browser print the
 * same string: printing with the runtime's own locale or zone made the server
 * and the phone disagree (React error #418) and made times flicker.
 */

export const SCHOOL_TIME_ZONE = "America/Detroit";

/** "Sunday, September 27" */
export function dayLabel(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: SCHOOL_TIME_ZONE,
  });
}

/** "9/27/2026" */
export function shortDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-US", { timeZone: SCHOOL_TIME_ZONE });
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
