/**
 * The admin overview: how today is going, what needs someone, and what is
 * coming up. Pure, so it is unit-tested; the page only fetches rows.
 */

import type { AssignmentStatus, TaskAssignment } from "./task-progress";

/** A scan still queued after this long means the scanner is not keeping up. */
export const SCANNER_STALE_MINUTES = 10;

/** Assignments count as sent once something reached review, whatever came of it. */
const SENT: AssignmentStatus[] = ["sent", "reshoot", "approved", "posted", "rejected"];

/** `count` calendar days ending on `last`, oldest first. UTC calendar days. */
export function daysEnding(last: string, count: number): string[] {
  const end = new Date(`${last}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (count - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/** `count` calendar days starting the day after `from`. */
export function daysAfter(from: string, count: number): string[] {
  const start = new Date(`${from}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i + 1);
    return d.toISOString().slice(0, 10);
  });
}

export function isWeekday(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export interface DayParticipation {
  date: string;
  due: number;
  sent: number;
}

/** Per day: how many assignments were due and how many came back. */
export function dailyParticipation(
  assignments: TaskAssignment[],
  statuses: Map<string, AssignmentStatus>,
  days: string[],
): DayParticipation[] {
  const byDay = new Map(days.map((date) => [date, { date, due: 0, sent: 0 }]));
  for (const assignment of assignments) {
    const day = byDay.get(assignment.dueOn);
    if (!day) continue;
    const status = statuses.get(assignment.id) ?? "not_sent";
    if (status === "upcoming") continue;
    day.due += 1;
    if (SENT.includes(status)) day.sent += 1;
  }
  return days.map((date) => byDay.get(date)!);
}

export interface QuietStudent {
  personId: string;
  name: string;
  missed: number;
  lastSentOn: string | null;
}

/**
 * Students who had at least `minMissed` assignments due in the window and sent
 * none of them. Most missed first, so the longest silence leads.
 */
export function quietStudents(
  students: Array<{ id: string; name: string }>,
  assignments: TaskAssignment[],
  statuses: Map<string, AssignmentStatus>,
  window: string[],
  minMissed = 2,
): QuietStudent[] {
  const inWindow = new Set(window);
  const tally = new Map<string, { due: number; sent: number; lastSentOn: string | null }>();
  for (const assignment of assignments) {
    const status = statuses.get(assignment.id) ?? "not_sent";
    const entry = tally.get(assignment.personId) ?? { due: 0, sent: 0, lastSentOn: null };
    if (SENT.includes(status) && (!entry.lastSentOn || assignment.dueOn > entry.lastSentOn)) {
      entry.lastSentOn = assignment.dueOn;
    }
    if (inWindow.has(assignment.dueOn) && status !== "upcoming") {
      entry.due += 1;
      if (SENT.includes(status)) entry.sent += 1;
    }
    tally.set(assignment.personId, entry);
  }
  return students
    .flatMap((student) => {
      const entry = tally.get(student.id);
      if (!entry || entry.sent > 0 || entry.due < minMissed) return [];
      return [{ personId: student.id, name: student.name, missed: entry.due, lastSentOn: entry.lastSentOn }];
    })
    .sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));
}

/** "just now", "12 minutes", "3 hours", "26 days": for "… ago" and "waiting …". */
export function elapsed(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

export interface UpcomingDay {
  date: string;
  assigned: number;
  /** A school day with nothing assigned: a hole in the daily habit. */
  gap: boolean;
}

export function upcomingDays(dates: string[], assignedOn: Map<string, number>): UpcomingDay[] {
  return dates.map((date) => {
    const assigned = assignedOn.get(date) ?? 0;
    return { date, assigned, gap: assigned === 0 && isWeekday(date) };
  });
}

export interface AttentionInput {
  now: Date;
  /** Oldest scan still pending or processing, and how many there are. */
  oldestScanQueuedAt: string | null;
  queuedScans: number;
  safetyReports: number;
  withdrawalRequests: number;
  /** Approved items whose tagged people are missing a release. */
  approvedBlockedByRelease: number;
  studentsAwaitingActivation: number;
  studentsNeedingParentRelease: number;
  tasksWithNobodyAssigned: number;
  nextGap: string | null;
}

export interface AttentionItem {
  id: string;
  tone: "bad" | "accent";
  title: string;
  detail: string;
  href: string;
  action: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What needs a person, most urgent first. Empty when nothing does. */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const scanWait = input.oldestScanQueuedAt
    ? (input.now.getTime() - new Date(input.oldestScanQueuedAt).getTime()) / 60000
    : 0;

  if (input.safetyReports) {
    items.push({
      id: "safety-reports",
      tone: "bad",
      title: `${plural(input.safetyReports, "safety report")} from students`,
      detail: "A student flagged a prompt or a clip as unsafe. Read it before anything else goes out.",
      href: "/review",
      action: "Read reports",
    });
  }
  if (input.queuedScans && scanWait >= SCANNER_STALE_MINUTES) {
    items.push({
      id: "scanner",
      tone: "bad",
      title: "The safety scanner looks stuck",
      detail: `${plural(input.queuedScans, "scan")} waiting; the oldest was queued ${elapsed(input.oldestScanQueuedAt!, input.now)} ago. Nothing can be posted until its scan finishes. Check the scanner job is running.`,
      href: "/review",
      action: "Open queue",
    });
  }
  if (input.withdrawalRequests) {
    items.push({
      id: "withdrawals",
      tone: "bad",
      title: `${plural(input.withdrawalRequests, "student")} asked to withdraw something`,
      detail: "Decide these quickly: a student is waiting to hear back.",
      href: "/review",
      action: "Decide",
    });
  }
  if (input.approvedBlockedByRelease) {
    items.push({
      id: "blocked-release",
      tone: "accent",
      title: `${plural(input.approvedBlockedByRelease, "approved item")} can't be posted yet`,
      detail: "Someone tagged in them is missing a release.",
      href: "/admin/people?filter=parental",
      action: "Collect releases",
    });
  }
  if (input.studentsAwaitingActivation) {
    items.push({
      id: "activation",
      tone: "accent",
      title: `${plural(input.studentsAwaitingActivation, "student")} waiting to be activated`,
      detail: "They are on the roster but can't take part until you activate them.",
      href: "/admin/people?filter=pending",
      action: "Review",
    });
  }
  if (input.studentsNeedingParentRelease) {
    items.push({
      id: "parental",
      tone: "accent",
      title: `${plural(input.studentsNeedingParentRelease, "student")} need a parent's release`,
      detail: "Under 18 or no birth year on file. Their clips can be reviewed but not posted.",
      href: "/admin/people?filter=parental",
      action: "Record releases",
    });
  }
  if (input.nextGap) {
    items.push({
      id: "gap",
      tone: "accent",
      title: `Nothing is scheduled for ${weekdayLabel(input.nextGap)}`,
      detail: "Students get no prompt that day.",
      href: "/admin/tasks",
      action: "Create a task",
    });
  }
  if (input.tasksWithNobodyAssigned) {
    items.push({
      id: "unassigned",
      tone: "accent",
      title: `${plural(input.tasksWithNobodyAssigned, "task")} with nobody assigned`,
      detail: "They exist but no student will ever see them.",
      href: "/admin/tasks",
      action: "Open tasks",
    });
  }
  return items;
}

/** "Monday, Sep 28" for a YYYY-MM-DD, without the viewer's time zone moving it. */
export function weekdayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
