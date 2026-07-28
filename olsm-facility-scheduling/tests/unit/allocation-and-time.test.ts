import { describe, expect, it } from "vitest";
import { expandRecurrence, weekdayRule } from "@/domain/recurrence";
import { detectCollisions, freeIntervals, type AllocationOccurrence } from "@/domain/allocation";
import { indexSubSpaces, type SubSpaceNode } from "@/domain/conflict-graph";
import { instantToLocalTime, localToInstant } from "@/lib/time";
import { quote } from "@/domain/pricing";
import type { RateCard } from "@prisma/client";

describe("local time handling", () => {
  it("round-trips a wall-clock time", () => {
    const instant = localToInstant("2026-01-15", "15:30");
    expect(instantToLocalTime(instant)).toBe("15:30");
  });

  /**
   * The reason standing blocks store wall-clock times rather than instants: a
   * 3:30 PM practice must stay 3:30 PM on both sides of the DST change.
   */
  it("keeps a practice at the same local time across the DST change", () => {
    const beforeDst = localToInstant("2026-03-06", "15:30"); // EST
    const afterDst = localToInstant("2026-03-13", "15:30"); // EDT
    expect(instantToLocalTime(beforeDst)).toBe("15:30");
    expect(instantToLocalTime(afterDst)).toBe("15:30");
    // Same wall clock, but seven days apart minus the hour the clocks moved.
    const days = (afterDst.getTime() - beforeDst.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7 - 1 / 24, 5);
  });
});

describe("recurrence expansion", () => {
  it("expands weekdays across a season", () => {
    const occurrences = expandRecurrence({
      rrule: weekdayRule(["MO", "TU", "WE", "TH", "FR"]),
      startTime: "15:30",
      endTime: "17:30",
      fromDate: "2026-11-09",
      toDate: "2026-11-20",
    });
    expect(occurrences).toHaveLength(10);
    expect(occurrences[0].date).toBe("2026-11-09");
    expect(instantToLocalTime(occurrences[0].startAt)).toBe("15:30");
    expect(instantToLocalTime(occurrences[0].endAt)).toBe("17:30");
  });

  it("skips excluded dates", () => {
    const occurrences = expandRecurrence({
      rrule: weekdayRule(["MO", "TU", "WE", "TH", "FR"]),
      startTime: "15:30",
      endTime: "17:30",
      fromDate: "2026-11-09",
      toDate: "2026-11-13",
      excludeDates: ["2026-11-11"],
    });
    expect(occurrences.map((o) => o.date)).not.toContain("2026-11-11");
    expect(occurrences).toHaveLength(4);
  });

  it("holds the local time steady across a DST boundary", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      startTime: "15:30",
      endTime: "17:30",
      fromDate: "2026-03-06",
      toDate: "2026-03-20",
    });
    for (const occ of occurrences) {
      expect(instantToLocalTime(occ.startAt)).toBe("15:30");
    }
  });
});

describe("season allocation collisions", () => {
  const index = indexSubSpaces([
    { id: "full", name: "Full court", facilityId: "gym", blocksIds: ["c1", "c2"] },
    { id: "c1", name: "Court 1", facilityId: "gym", blocksIds: [] },
    { id: "c2", name: "Court 2", facilityId: "gym", blocksIds: [] },
  ] satisfies SubSpaceNode[]);

  function occ(
    blockId: string,
    subSpaceId: string,
    startHour: number,
    endHour: number,
    priority: number,
  ): AllocationOccurrence {
    return {
      blockId,
      blockLabel: blockId,
      sportName: blockId,
      teamLevel: "VARSITY",
      subSpaceId,
      subSpaceName: subSpaceId,
      priority,
      date: "2026-11-10",
      startAt: localToInstant("2026-11-10", `${String(startHour).padStart(2, "0")}:00`),
      endAt: localToInstant("2026-11-10", `${String(endHour).padStart(2, "0")}:00`),
    };
  }

  it("finds a collision between the full court and one half", () => {
    const report = detectCollisions(
      [occ("boys", "full", 15, 17, 20), occ("girls", "c1", 16, 18, 21)],
      [],
      index,
    );
    expect(report.collisions).toHaveLength(1);
    expect(report.publishable).toBe(false);
    expect(report.collisions[0].sharedSubSpaceIds).toContain("c1");
    expect(report.collisions[0].suggested).toBe("left"); // boys varsity outranks
  });

  it("allows the two halves to run at once", () => {
    const report = detectCollisions(
      [occ("boys", "c1", 15, 17, 20), occ("girls", "c2", 15, 17, 20)],
      [],
      index,
    );
    expect(report.collisions).toHaveLength(0);
    expect(report.publishable).toBe(true);
  });

  it("does not flag back-to-back blocks", () => {
    const report = detectCollisions(
      [occ("boys", "full", 15, 17, 20), occ("girls", "full", 17, 19, 21)],
      [],
      index,
    );
    expect(report.collisions).toHaveLength(0);
  });

  it("flags a collision against an existing booking", () => {
    const report = detectCollisions(
      [occ("boys", "c1", 15, 17, 20)],
      [
        {
          bookingId: "b1",
          reference: "OLSM-1",
          title: "Alumni event",
          subSpaceId: "full",
          subSpaceName: "Full court",
          priority: 40,
          startAt: localToInstant("2026-11-10", "16:00"),
          endAt: localToInstant("2026-11-10", "18:00"),
        },
      ],
      index,
    );
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0].kind).toBe("block-vs-booking");
    expect(report.collisions[0].suggested).toBe("left");
  });
});

describe("open inventory", () => {
  const day = (t: string) => localToInstant("2026-11-10", t);

  it("reports the gaps between busy blocks", () => {
    const free = freeIntervals(
      { start: day("06:00"), end: day("22:00") },
      [
        { start: day("15:30"), end: day("17:30") },
        { start: day("18:00"), end: day("20:00") },
      ],
    );
    expect(free).toHaveLength(3);
    expect(instantToLocalTime(free[0].start)).toBe("06:00");
    expect(instantToLocalTime(free[1].start)).toBe("17:30");
    expect(instantToLocalTime(free[2].end)).toBe("22:00");
  });

  it("ignores gaps shorter than the minimum", () => {
    const free = freeIntervals(
      { start: day("06:00"), end: day("22:00") },
      [
        { start: day("06:00"), end: day("17:30") },
        { start: day("17:45"), end: day("22:00") },
      ],
      30,
    );
    expect(free).toHaveLength(0);
  });

  it("merges overlapping busy blocks", () => {
    const free = freeIntervals(
      { start: day("06:00"), end: day("22:00") },
      [
        { start: day("08:00"), end: day("12:00") },
        { start: day("10:00"), end: day("14:00") },
      ],
    );
    expect(free).toHaveLength(2);
    expect(instantToLocalTime(free[1].start)).toBe("14:00");
  });
});

describe("pricing", () => {
  const card = (overrides: Partial<RateCard>): RateCard =>
    ({
      id: "rc1",
      facilityId: "gym",
      activityType: "EXTERNAL_RENTAL",
      rateTier: "COMMERCIAL",
      hourlyCents: 18000,
      flatDayCents: 108000,
      minHours: 2,
      depositCents: 50000,
      effectiveFrom: new Date("2020-01-01T00:00:00Z"),
      effectiveTo: null,
      ...overrides,
    }) as RateCard;

  it("bills hourly with a minimum", () => {
    const result = quote({
      rateCards: [card({})],
      facilityId: "gym",
      activityType: "EXTERNAL_RENTAL",
      rateTier: "COMMERCIAL",
      startAt: new Date("2026-06-01T18:00:00Z"),
      endAt: new Date("2026-06-01T19:00:00Z"),
    });
    // One hour requested, two-hour minimum applied.
    expect(result.billedHours).toBe(2);
    expect(result.subtotalCents).toBe(36000);
  });

  it("caps a long rental at the flat day rate", () => {
    const result = quote({
      rateCards: [card({})],
      facilityId: "gym",
      activityType: "EXTERNAL_RENTAL",
      rateTier: "COMMERCIAL",
      startAt: new Date("2026-06-01T14:00:00Z"),
      endAt: new Date("2026-06-01T22:00:00Z"),
    });
    expect(result.subtotalCents).toBe(108000);
  });

  it("keeps the deposit out of the charged total", () => {
    const result = quote({
      rateCards: [card({})],
      facilityId: "gym",
      activityType: "EXTERNAL_RENTAL",
      rateTier: "COMMERCIAL",
      startAt: new Date("2026-06-01T18:00:00Z"),
      endAt: new Date("2026-06-01T20:00:00Z"),
    });
    expect(result.depositCents).toBe(50000);
    expect(result.totalCents).toBe(36000);
  });

  it("adds hourly surcharges", () => {
    const result = quote({
      rateCards: [card({ depositCents: 0 })],
      facilityId: "gym",
      activityType: "EXTERNAL_RENTAL",
      rateTier: "COMMERCIAL",
      startAt: new Date("2026-06-01T18:00:00Z"),
      endAt: new Date("2026-06-01T20:00:00Z"),
      surcharges: [{ code: "LIGHTS", label: "Field lights", kind: "hourly", amountCents: 7500 }],
    });
    expect(result.subtotalCents).toBe(36000 + 15000);
  });

  it("reports an unpriced booking rather than charging zero silently", () => {
    const result = quote({
      rateCards: [],
      facilityId: "gym",
      activityType: "EXTERNAL_RENTAL",
      rateTier: "COMMERCIAL",
      startAt: new Date("2026-06-01T18:00:00Z"),
      endAt: new Date("2026-06-01T20:00:00Z"),
    });
    expect(result.unpriced).toBe(true);
  });
});
