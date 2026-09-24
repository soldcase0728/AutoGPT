import { describe, expect, it } from "vitest";
import { assignmentStatuses, schoolDays, taskProgress, type TaskAssignment, type TaskCapture } from "@/lib/task-progress";

const assignments: TaskAssignment[] = [
  { id: "a1", personId: "ali", dueOn: "2026-09-21" },
  { id: "a2", personId: "jo", dueOn: "2026-09-21" },
  { id: "a3", personId: "sam", dueOn: "2026-09-21" },
  { id: "a4", personId: "ali", dueOn: "2026-09-25" },
  { id: "a5", personId: "kit", dueOn: "2026-09-22" },
];

const at = "2026-09-21T15:00:00Z";
const captures: TaskCapture[] = [
  { assignmentId: "a1", state: "published", submittedAt: at, stateChangedAt: at },
  { assignmentId: "a2", state: "uploading", submittedAt: null, stateChangedAt: at },
  { assignmentId: "a3", state: "withdrawn", submittedAt: null, stateChangedAt: at },
  { assignmentId: "a3", state: "changes_requested", submittedAt: at, stateChangedAt: at },
];

describe("assignmentStatuses", () => {
  const statuses = assignmentStatuses(assignments, captures, "2026-09-23");

  it("reads each assignment's furthest capture", () => {
    expect(statuses.get("a1")).toBe("posted");
    expect(statuses.get("a3")).toBe("reshoot");
  });

  it("treats an unsent upload as not sent", () => {
    expect(statuses.get("a2")).toBe("not_sent");
  });

  it("separates future assignments from missing ones", () => {
    expect(statuses.get("a4")).toBe("upcoming");
    expect(statuses.get("a5")).toBe("not_sent");
  });
});

describe("taskProgress", () => {
  it("counts sent, approved and posted, and lists who is missing", () => {
    const progress = taskProgress(assignments, assignmentStatuses(assignments, captures, "2026-09-23"));
    expect(progress).toMatchObject({ assigned: 5, due: 4, sent: 2, approved: 1, posted: 1 });
    expect(progress.missingPersonIds.sort()).toEqual(["jo", "kit"]);
  });
});

describe("schoolDays", () => {
  const week = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"];
  it("drops Saturday and Sunday when asked", () => {
    expect(schoolDays(week, true)).toEqual(["2026-09-25", "2026-09-28"]);
    expect(schoolDays(week, false)).toEqual(week);
  });
});
