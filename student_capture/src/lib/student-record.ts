/**
 * What a student has to show for their effort: a streak, totals, and the
 * newest thing of theirs that went live. Pure, so it is unit-tested.
 */

import type { AssignmentStatus, TaskAssignment } from "./task-progress";

const SENT: AssignmentStatus[] = ["sent", "reshoot", "approved", "posted", "rejected"];

export interface StudentRecord {
  /** Prompts sent in a row, counting back from the most recent one due. */
  streak: number;
  sent: number;
  posted: number;
}

/**
 * Today's prompt doesn't break a streak while it can still be sent: the streak
 * counts back from the last prompt that was actually missed.
 */
export function studentRecord(
  assignments: TaskAssignment[],
  statuses: Map<string, AssignmentStatus>,
  today: string,
  postedCount: number,
): StudentRecord {
  const due = assignments
    .filter((a) => a.dueOn <= today)
    .sort((a, b) => b.dueOn.localeCompare(a.dueOn));
  let streak = 0;
  for (const assignment of due) {
    const status = statuses.get(assignment.id) ?? "not_sent";
    if (SENT.includes(status)) {
      streak += 1;
      continue;
    }
    if (assignment.dueOn === today && status === "not_sent") continue;
    break;
  }
  const sent = assignments.filter((a) => SENT.includes(statuses.get(a.id) ?? "not_sent")).length;
  return { streak, sent, posted: postedCount };
}

export interface PostedCapture {
  id: string;
  title: string;
  postedAt: string;
  postUrl: string | null;
}

/** The newest post in the last `days` days, to celebrate; null if none. */
export function recentPost(posts: PostedCapture[], now: Date, days = 7): PostedCapture | null {
  const since = now.getTime() - days * 86_400_000;
  return (
    posts
      .filter((p) => new Date(p.postedAt).getTime() >= since)
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0] ?? null
  );
}

export interface CommunityStats {
  weekPosted: number;
  weekContributors: number;
  groups: Array<{ name: string; kind: string; members: number; weekSent: number }>;
}

/** The RPC's JSON, checked field by field; null if it is missing or malformed. */
export function parseCommunityStats(raw: unknown): CommunityStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  const groups = Array.isArray(r.groups) ? r.groups : [];
  return {
    weekPosted: num(r.week_posted),
    weekContributors: num(r.week_contributors),
    groups: groups.flatMap((g) => {
      if (!g || typeof g !== "object") return [];
      const row = g as Record<string, unknown>;
      if (typeof row.name !== "string") return [];
      return [{
        name: row.name,
        kind: typeof row.kind === "string" ? row.kind : "list",
        members: num(row.members),
        weekSent: num(row.week_sent),
      }];
    }),
  };
}

export interface TeamBoard {
  optedIn: boolean;
  groups: Array<{
    name: string;
    kind: string;
    entries: Array<{ firstName: string; weekSent: number; weekPosted: number; me: boolean }>;
  }>;
}

/** The team-board RPC's JSON, checked field by field; null if missing or malformed. */
export function parseTeamBoard(raw: unknown): TeamBoard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  const groups = Array.isArray(r.groups) ? r.groups : [];
  return {
    optedIn: r.opted_in === true,
    groups: groups.flatMap((g) => {
      if (!g || typeof g !== "object") return [];
      const row = g as Record<string, unknown>;
      if (typeof row.name !== "string") return [];
      const entries = Array.isArray(row.entries) ? row.entries : [];
      return [{
        name: row.name,
        kind: typeof row.kind === "string" ? row.kind : "list",
        entries: entries.flatMap((e) => {
          if (!e || typeof e !== "object") return [];
          const entry = e as Record<string, unknown>;
          if (typeof entry.first_name !== "string" || !entry.first_name) return [];
          return [{
            firstName: entry.first_name,
            weekSent: num(entry.week_sent),
            weekPosted: num(entry.week_posted),
            me: entry.me === true,
          }];
        }),
      }];
    }),
  };
}
