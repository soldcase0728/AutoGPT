import { describe, expect, it } from "vitest";
import { cleanTaskTitle, expandTaskDates, taskAssignSchema, taskCreateSchema } from "@/lib/admin-task";

const valid = {
  campaignId: "41111111-1111-1111-1111-111111111111",
  title: "Hallway energy",
  brief: "Capture one safe, steady photo between classes.",
  mediaType: "photo" as const,
  orientation: "landscape" as const,
  startsOn: "2026-09-07",
  endsOn: "2026-09-11",
  studentIds: ["63333333-3333-3333-3333-333333333333"],
  guidelineSetIds: ["22222222-2222-2222-2222-222222222222"],
  minMediaCount: 1,
  maxMediaCount: 1,
  minDurationSeconds: null,
  maxDurationSeconds: null,
  captionRequired: false,
};

describe("expandTaskDates", () => {
  it("builds an inclusive daily schedule", () => {
    expect(expandTaskDates("2026-09-07", "2026-09-11")).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    ]);
  });

  it("rejects reversed, impossible, and oversized ranges", () => {
    expect(expandTaskDates("2026-09-11", "2026-09-07")).toBeNull();
    expect(expandTaskDates("2026-02-30", "2026-03-01")).toBeNull();
    expect(expandTaskDates("2026-09-01", "2026-10-02")).toBeNull();
  });
});

describe("taskCreateSchema", () => {
  it("accepts a valid weekly photo task", () => {
    expect(taskCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a task with nobody assigned yet", () => {
    const parsed = taskCreateSchema.safeParse({ ...valid, studentIds: [] });
    expect(parsed.success).toBe(true);
    const { studentIds: _omit, ...withoutStudents } = valid;
    void _omit;
    expect(taskCreateSchema.safeParse(withoutStudents).data?.studentIds).toEqual([]);
  });

  it("requires video durations and reserves multi-item counts for photo series", () => {
    expect(taskCreateSchema.safeParse({ ...valid, mediaType: "video" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...valid, maxMediaCount: 3 }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...valid, mediaType: "photo_series", maxMediaCount: 3 }).success).toBe(true);
  });
});

describe("cleanTaskTitle", () => {
  it("strips every copy suffix a duplicate picked up", () => {
    expect(cleanTaskTitle("Pre-game, ninety minutes out — copy — copy — copy")).toBe("Pre-game, ninety minutes out");
    expect(cleanTaskTitle("Your view right now (copy)")).toBe("Your view right now");
    expect(cleanTaskTitle("Test 1 - copy")).toBe("Test 1");
  });

  it("leaves a real title alone", () => {
    expect(cleanTaskTitle("Copy the playbook")).toBe("Copy the playbook");
    expect(cleanTaskTitle("Pre-game")).toBe("Pre-game");
  });
});

describe("taskAssignSchema", () => {
  const assign = { action: "assign", studentIds: ["63333333-3333-3333-3333-333333333333"], startsOn: "2026-10-05", endsOn: "2026-10-09", weekdaysOnly: true };

  it("assigns an existing task to students over a range", () => {
    expect(taskAssignSchema.safeParse(assign).success).toBe(true);
  });

  it("needs at least one student and a sane range", () => {
    expect(taskAssignSchema.safeParse({ ...assign, studentIds: [] }).success).toBe(false);
    expect(taskAssignSchema.safeParse({ ...assign, endsOn: "2026-10-01" }).success).toBe(false);
  });
});
