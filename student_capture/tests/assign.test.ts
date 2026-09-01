import { describe, expect, it } from "vitest";
import { daysAgo, isoDate, pickIdea } from "@/lib/assign";

const ideas = [
  { id: "a", weight: 1 },
  { id: "b", weight: 1 },
  { id: "c", weight: 1 },
];

describe("pickIdea", () => {
  it("returns nothing when the bank is empty", () => {
    expect(pickIdea([], [], () => 0.5)).toBeNull();
  });

  it("holds back what the student shot recently", () => {
    const picked = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const id = pickIdea(ideas, ["a", "b"], () => i / 40);
      if (id) picked.add(id);
    }
    expect([...picked]).toEqual(["c"]);
  });

  it("reopens the whole bank rather than assigning nothing", () => {
    expect(pickIdea(ideas, ["a", "b", "c"], () => 0.1)).toBe("a");
  });

  it("respects weight", () => {
    const weighted = [
      { id: "rare", weight: 1 },
      { id: "common", weight: 9 },
    ];
    const counts: Record<string, number> = { rare: 0, common: 0 };
    for (let i = 0; i < 1000; i += 1) {
      const id = pickIdea(weighted, [], () => i / 1000);
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.common).toBeGreaterThan(counts.rare! * 5);
  });

  it("never falls off the end of the pool", () => {
    for (const r of [0, 0.999999, 1]) {
      expect(pickIdea(ideas, [], () => r)).not.toBeNull();
    }
  });
});

describe("date helpers", () => {
  it("formats an ISO day", () => {
    expect(isoDate(new Date("2026-09-01T22:30:00Z"))).toBe("2026-09-01");
  });

  it("walks back across a month boundary", () => {
    expect(daysAgo("2026-09-01", 14)).toBe("2026-08-18");
  });
});
