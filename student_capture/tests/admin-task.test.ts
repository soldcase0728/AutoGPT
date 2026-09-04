import { describe, expect, it } from "vitest";
import { expandTaskDates, taskCreateSchema } from "@/lib/admin-task";

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

  it("requires video durations and reserves multi-item counts for photo series", () => {
    expect(taskCreateSchema.safeParse({ ...valid, mediaType: "video" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...valid, maxMediaCount: 3 }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ ...valid, mediaType: "photo_series", maxMediaCount: 3 }).success).toBe(true);
  });
});
