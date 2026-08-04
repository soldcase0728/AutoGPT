import { describe, expect, it } from "vitest";
import {
  NON_TEAM_COLOR,
  SPORT_PALETTE,
  colorForSport,
  legendFor,
  slotForSport,
} from "@/domain/sport-colors";

/** WCAG relative luminance, so the ink checks are computed rather than trusted. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the palette stays readable", () => {
  it("clears WCAG AA for the 11px text on every block", () => {
    // The calendar draws block titles at 11px, which is small text: 4.5:1.
    for (const swatch of [...SPORT_PALETTE, NON_TEAM_COLOR]) {
      expect(
        contrast(swatch.fill, swatch.ink),
        `${swatch.name} ${swatch.fill} on ${swatch.ink}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps six hues and no more", () => {
    // Eleven mutually distinguishable colours do not exist at this size; eight
    // already fail on all pairs. Growing this list is not a free change -- it
    // needs the palette validator rerun, so the count is pinned here.
    expect(SPORT_PALETTE).toHaveLength(6);
    expect(new Set(SPORT_PALETTE.map((s) => s.fill)).size).toBe(6);
  });

  it("keeps non-team use outside the sport palette", () => {
    expect(SPORT_PALETTE.map((s) => s.fill)).not.toContain(NON_TEAM_COLOR.fill);
  });
});

describe("a sport's colour does not move", () => {
  it("uses the slot the sport carries", () => {
    expect(slotForSport({ name: "Football", colorSlot: 1 })).toBe(0);
    expect(slotForSport({ name: "Wrestling", colorSlot: 6 })).toBe(5);
  });

  it("falls back to a stable hue for a sport nobody assigned one", () => {
    const first = slotForSport({ name: "Girls Soccer", colorSlot: null });
    const again = slotForSport({ name: "Girls Soccer", colorSlot: null });
    expect(first).toBe(again);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(SPORT_PALETTE.length);
  });

  it("ignores a slot outside the palette rather than crashing", () => {
    const slot = slotForSport({ name: "Curling", colorSlot: 99 });
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(SPORT_PALETTE.length);
  });

  it("gives anything without a sport the non-team colour", () => {
    expect(colorForSport(null)).toEqual(NON_TEAM_COLOR);
  });
});

describe("the legend describes what is on screen", () => {
  const bball = { id: "s1", name: "Boys Basketball", colorSlot: 4 };
  const wrestling = { id: "s2", name: "Wrestling", colorSlot: 6 };

  it("lists each sport once, alphabetically", () => {
    const entries = legendFor([
      { sport: wrestling },
      { sport: bball },
      { sport: bball },
    ]);
    expect(entries.map((e) => e.label)).toEqual(["Boys Basketball", "Wrestling"]);
  });

  it("omits sports that are not in view", () => {
    // The point of the legend is to be a key, not a catalogue.
    const entries = legendFor([{ sport: bball }]);
    expect(entries).toHaveLength(1);
  });

  it("adds one entry covering everything without a sport", () => {
    const entries = legendFor([{ sport: bball }, { sport: null }, { sport: null }]);
    expect(entries).toHaveLength(2);
    expect(entries[1].label).toMatch(/rentals/i);
    expect(entries[1].color).toEqual(NON_TEAM_COLOR);
  });

  it("is empty when nothing is booked", () => {
    expect(legendFor([])).toEqual([]);
  });
});

describe("sports sharing a season never share a hue", () => {
  it("holds for the seeded roster", () => {
    // This is the case a coach actually sees. Six slots cannot also keep
    // neighbouring seasons apart -- fall and winter hold seven sports between
    // them -- so the guarantee is deliberately scoped to one season.
    const roster = [
      { name: "Football", season: "FALL", colorSlot: 1 },
      { name: "Boys Soccer", season: "FALL", colorSlot: 2 },
      { name: "Cross Country", season: "FALL", colorSlot: 3 },
      { name: "Boys Basketball", season: "WINTER", colorSlot: 4 },
      { name: "Girls Basketball", season: "WINTER", colorSlot: 5 },
      { name: "Wrestling", season: "WINTER", colorSlot: 6 },
      { name: "Hockey", season: "WINTER", colorSlot: 3 },
      { name: "Baseball", season: "SPRING", colorSlot: 1 },
      { name: "Track & Field", season: "SPRING", colorSlot: 2 },
      { name: "Rowing", season: "SPRING", colorSlot: 5 },
      { name: "Lacrosse", season: "SPRING", colorSlot: 6 },
    ];

    for (const season of ["FALL", "WINTER", "SPRING"]) {
      const inSeason = roster.filter((s) => s.season === season);
      const slots = inSeason.map((s) => slotForSport(s));
      expect(new Set(slots).size, `${season} has a colour collision`).toBe(inSeason.length);
    }
  });
});
