import { describe, expect, it } from "vitest";
import {
  attentionItems,
  dailyParticipation,
  daysAfter,
  daysEnding,
  elapsed,
  quietStudents,
  upcomingDays,
  weekdayLabel,
  type AttentionInput,
} from "@/lib/dashboard";
import type { AssignmentStatus, TaskAssignment } from "@/lib/task-progress";

const assignments: TaskAssignment[] = [
  { id: "a1", personId: "ali", dueOn: "2026-09-21" },
  { id: "a2", personId: "jo", dueOn: "2026-09-21" },
  { id: "a3", personId: "ali", dueOn: "2026-09-22" },
  { id: "a4", personId: "jo", dueOn: "2026-09-22" },
  { id: "a5", personId: "jo", dueOn: "2026-09-23" },
  { id: "a6", personId: "sam", dueOn: "2026-09-23" },
  { id: "a7", personId: "ali", dueOn: "2026-09-25" },
];

const statuses = new Map<string, AssignmentStatus>([
  ["a1", "posted"],
  ["a2", "not_sent"],
  ["a3", "rejected"],
  ["a4", "withdrawn"],
  ["a5", "not_sent"],
  ["a6", "not_sent"],
  ["a7", "upcoming"],
]);

describe("day ranges", () => {
  it("ends on the given day, oldest first", () => {
    expect(daysEnding("2026-09-02", 3)).toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  it("starts the day after", () => {
    expect(daysAfter("2026-09-30", 2)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("dailyParticipation", () => {
  const days = daysEnding("2026-09-25", 5);
  const result = dailyParticipation(assignments, statuses, days);

  it("counts anything that reached review as sent, whatever came of it", () => {
    expect(result.find((d) => d.date === "2026-09-21")).toEqual({ date: "2026-09-21", due: 2, sent: 1 });
    expect(result.find((d) => d.date === "2026-09-22")).toEqual({ date: "2026-09-22", due: 2, sent: 1 });
  });

  it("does not count what isn't due yet", () => {
    expect(result.find((d) => d.date === "2026-09-25")).toEqual({ date: "2026-09-25", due: 0, sent: 0 });
  });

  it("returns every day in order, including empty ones", () => {
    expect(result.map((d) => d.date)).toEqual(days);
    expect(result.find((d) => d.date === "2026-09-24")?.due).toBe(0);
  });
});

describe("quietStudents", () => {
  const students = [
    { id: "ali", name: "Ali" },
    { id: "jo", name: "Jo" },
    { id: "sam", name: "Sam" },
  ];
  const window = daysEnding("2026-09-25", 7);

  it("lists students who missed enough and sent nothing", () => {
    expect(quietStudents(students, assignments, statuses, window)).toEqual([
      { personId: "jo", name: "Jo", missed: 3, lastSentOn: null },
    ]);
  });

  it("leaves out anyone who sent something in the window", () => {
    expect(quietStudents(students, assignments, statuses, window).some((s) => s.personId === "ali")).toBe(false);
  });

  it("respects the missed threshold", () => {
    expect(quietStudents(students, assignments, statuses, window, 1).map((s) => s.personId)).toEqual(["jo", "sam"]);
  });
});

describe("elapsed", () => {
  const now = new Date("2026-09-27T12:00:00Z");

  it("reads naturally at each scale", () => {
    expect(elapsed("2026-09-27T11:59:40Z", now)).toBe("just now");
    expect(elapsed("2026-09-27T11:59:00Z", now)).toBe("1 minute");
    expect(elapsed("2026-09-27T11:15:00Z", now)).toBe("45 minutes");
    expect(elapsed("2026-09-27T09:00:00Z", now)).toBe("3 hours");
    expect(elapsed("2026-09-01T12:00:00Z", now)).toBe("26 days");
  });
});

describe("upcomingDays", () => {
  it("flags only school days with nothing assigned", () => {
    const days = upcomingDays(["2026-09-26", "2026-09-28", "2026-09-29"], new Map([["2026-09-29", 4]]));
    expect(days).toEqual([
      { date: "2026-09-26", assigned: 0, gap: false },
      { date: "2026-09-28", assigned: 0, gap: true },
      { date: "2026-09-29", assigned: 4, gap: false },
    ]);
  });
});

describe("attentionItems", () => {
  const quiet: AttentionInput = {
    now: new Date("2026-09-27T12:00:00Z"),
    oldestScanQueuedAt: null,
    queuedScans: 0,
    safetyReports: 0,
    withdrawalRequests: 0,
    approvedBlockedByRelease: 0,
    studentsAwaitingActivation: 0,
    studentsNeedingParentRelease: 0,
    tasksWithNobodyAssigned: 0,
    nextGap: null,
  };

  it("is empty when nothing needs anyone", () => {
    expect(attentionItems(quiet)).toEqual([]);
  });

  it("puts safety first", () => {
    const items = attentionItems({
      ...quiet,
      tasksWithNobodyAssigned: 2,
      safetyReports: 1,
      oldestScanQueuedAt: "2026-09-27T11:00:00Z",
      queuedScans: 3,
    });
    expect(items.map((i) => i.id)).toEqual(["safety-reports", "scanner", "unassigned"]);
    expect(items[1]?.detail).toContain("queued 1 hour ago");
  });

  it("does not call a scan that just started stuck", () => {
    const items = attentionItems({ ...quiet, oldestScanQueuedAt: "2026-09-27T11:55:00Z", queuedScans: 1 });
    expect(items).toEqual([]);
  });

  it("names the next empty school day", () => {
    const [gap] = attentionItems({ ...quiet, nextGap: "2026-09-28" });
    expect(gap?.title).toBe("Nothing is scheduled for Monday, Sep 28");
  });

  it("uses singular and plural wording", () => {
    expect(attentionItems({ ...quiet, withdrawalRequests: 1 })[0]?.title).toBe("1 student asked to withdraw something");
    expect(attentionItems({ ...quiet, approvedBlockedByRelease: 2 })[0]?.title).toBe("2 approved items can't be posted yet");
  });
});

describe("weekdayLabel", () => {
  it("does not shift the day by time zone", () => {
    expect(weekdayLabel("2026-09-28")).toBe("Monday, Sep 28");
  });
});
