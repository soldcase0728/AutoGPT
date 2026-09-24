/**
 * Where a content task stands: how many assignments came back, how far they
 * got, and who is still missing. Pure, so it is unit-tested.
 */

import type { CaptureState } from "./types";

export interface TaskAssignment {
  id: string;
  personId: string;
  dueOn: string;
}

export interface TaskCapture {
  assignmentId: string | null;
  state: CaptureState;
  submittedAt: string | null;
  stateChangedAt: string;
}

export type AssignmentStatus =
  | "upcoming"
  | "not_sent"
  | "sent"
  | "reshoot"
  | "approved"
  | "posted"
  | "rejected"
  | "withdrawn";

export const STATUS_LABEL: Record<AssignmentStatus, string> = {
  upcoming: "Not due yet",
  not_sent: "Not sent",
  sent: "Sent, waiting for review",
  reshoot: "Reshoot asked",
  approved: "Approved",
  posted: "Posted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const RANK: Record<CaptureState, number> = {
  uploading: 0,
  withdrawn: 0,
  submitted: 1,
  in_review: 1,
  withdrawal_requested: 1,
  changes_requested: 2,
  rejected: 2,
  approved: 3,
  published: 4,
};

function statusOf(capture: TaskCapture): AssignmentStatus {
  switch (capture.state) {
    case "submitted":
    case "in_review":
    case "withdrawal_requested":
      return "sent";
    case "changes_requested":
      return "reshoot";
    case "approved":
      return "approved";
    case "published":
      return "posted";
    case "rejected":
      return "rejected";
    case "withdrawn":
      return capture.submittedAt ? "withdrawn" : "not_sent";
    default:
      return "not_sent";
  }
}

export function assignmentStatuses(
  assignments: TaskAssignment[],
  captures: TaskCapture[],
  today: string,
): Map<string, AssignmentStatus> {
  const best = new Map<string, TaskCapture>();
  for (const capture of captures) {
    if (!capture.assignmentId) continue;
    const seen = best.get(capture.assignmentId);
    if (
      !seen ||
      RANK[capture.state] > RANK[seen.state] ||
      (RANK[capture.state] === RANK[seen.state] && capture.stateChangedAt > seen.stateChangedAt)
    ) {
      best.set(capture.assignmentId, capture);
    }
  }
  const result = new Map<string, AssignmentStatus>();
  for (const assignment of assignments) {
    const capture = best.get(assignment.id);
    const status = capture ? statusOf(capture) : "not_sent";
    result.set(assignment.id, status === "not_sent" && assignment.dueOn > today ? "upcoming" : status);
  }
  return result;
}

export interface TaskProgress {
  assigned: number;
  due: number;
  sent: number;
  approved: number;
  posted: number;
  /** People with at least one assignment due and not sent. */
  missingPersonIds: string[];
}

export function taskProgress(
  assignments: TaskAssignment[],
  statuses: Map<string, AssignmentStatus>,
): TaskProgress {
  const missing = new Set<string>();
  let due = 0;
  let sent = 0;
  let approved = 0;
  let posted = 0;
  for (const assignment of assignments) {
    const status = statuses.get(assignment.id) ?? "not_sent";
    if (status !== "upcoming") due += 1;
    if (status === "not_sent") missing.add(assignment.personId);
    if (!["upcoming", "not_sent", "withdrawn"].includes(status)) sent += 1;
    if (status === "approved" || status === "posted") approved += 1;
    if (status === "posted") posted += 1;
  }
  return {
    assigned: assignments.length,
    due,
    sent,
    approved,
    posted,
    missingPersonIds: [...missing],
  };
}

/** Dates in a range, optionally weekdays only. Inclusive; UTC calendar days. */
export function schoolDays(dates: string[], weekdaysOnly: boolean): string[] {
  if (!weekdaysOnly) return dates;
  return dates.filter((date) => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
  });
}
