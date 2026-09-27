import { describe, expect, it } from "vitest";
import { awardDateLabel, localDate, recentAwards } from "@/lib/shot-of-the-day";

describe("shot of the day helpers", () => {
  it("formats the viewer's local date", () => {
    expect(localDate(new Date(2026, 8, 7, 23, 30))).toBe("2026-09-07");
  });

  it("labels an award date without shifting it", () => {
    expect(awardDateLabel("2026-09-27")).toBe("Sunday, Sep 27");
  });

  it("keeps the last week's awards, newest first", () => {
    const awards = [
      { id: "a", awardedOn: "2026-09-10" },
      { id: "b", awardedOn: "2026-09-25" },
      { id: "c", awardedOn: "2026-09-27" },
      { id: "d", awardedOn: "2026-09-21" },
    ];
    expect(recentAwards(awards, "2026-09-27").map((a) => a.id)).toEqual(["c", "b", "d"]);
  });
});
