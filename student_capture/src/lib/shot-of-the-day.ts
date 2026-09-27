/**
 * Shot of the Day, as the pages see it. Pure, so it is unit-tested.
 */

export interface ShotAward {
  id: string;
  captureId: string;
  awardedOn: string;
  note: string | null;
}

/** The viewer's own calendar date, YYYY-MM-DD, for an award picked "today". */
export function localDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "Sunday, Sep 27" for an award date, without a time zone moving it. */
export function awardDateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Awards from the last `days` days, newest first: the ones worth celebrating now. */
export function recentAwards<T extends { awardedOn: string }>(awards: T[], today: string, days = 7): T[] {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - days);
  const cutoff = since.toISOString().slice(0, 10);
  return awards.filter((a) => a.awardedOn > cutoff && a.awardedOn <= today).sort((a, b) => b.awardedOn.localeCompare(a.awardedOn));
}
