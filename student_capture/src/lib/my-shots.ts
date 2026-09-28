/**
 * The two tabs on a student's My shots page. Pure, so it is unit-tested.
 */

export type ShotsTab = "done" | "open";

/** Row states that still need the student to do something. */
const OPEN = new Set(["assigned", "uploading", "changes_requested", "reshooting"]);

/** Where a row belongs: to do, sent (whatever came of it), or missed. */
export function shotBucket(state: string): "open" | "done" | "missed" {
  if (OPEN.has(state)) return "open";
  if (state === "expired") return "missed";
  return "done";
}

export function resolveShotsTab(raw: string | null | undefined, openCount: number): ShotsTab {
  if (raw === "open" || raw === "done") return raw;
  // Land where there is something to do; otherwise on what they've sent.
  return openCount > 0 ? "open" : "done";
}

/**
 * Split rows into the tabs. Open tasks run soonest first, so today's is on
 * top; sent shots run newest first; missed ones trail the open list.
 */
export function splitShots<T extends { state: string; occurredAt: string }>(rows: T[]) {
  const open = rows.filter((r) => shotBucket(r.state) === "open").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const missed = rows.filter((r) => shotBucket(r.state) === "missed").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const done = rows.filter((r) => shotBucket(r.state) === "done").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { open, missed, done };
}
