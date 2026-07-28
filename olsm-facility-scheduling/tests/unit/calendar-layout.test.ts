import { describe, expect, it } from "vitest";
import {
  formatMinutes,
  gridBounds,
  layoutColumn,
  snapMinutes,
  type TimeSpan,
} from "@/domain/calendar-layout";

const DAY_START = 6 * 60; // 06:00
const DAY_END = 22 * 60; // 22:00

function span(startHour: number, endHour: number): TimeSpan {
  return { startMinutes: startHour * 60, endMinutes: endHour * 60 };
}

describe("calendar column layout", () => {
  it("gives a lone booking the full width", () => {
    const [item] = layoutColumn([span(15, 17)], DAY_START, DAY_END);
    expect(item.width).toBe(100);
    expect(item.left).toBe(0);
    expect(item.lane).toBe(0);
  });

  it("positions a booking proportionally down the column", () => {
    const [item] = layoutColumn([span(14, 15)], DAY_START, DAY_END);
    // 14:00 is 8 of the 16 rendered hours in.
    expect(item.top).toBeCloseTo(50, 5);
    expect(item.height).toBeCloseTo(100 / 16, 5);
  });

  it("splits two overlapping bookings into halves", () => {
    const items = layoutColumn([span(15, 17), span(16, 18)], DAY_START, DAY_END);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.width === 50)).toBe(true);
    expect(items.map((i) => i.left).sort()).toEqual([0, 50]);
  });

  it("keeps back-to-back bookings full width", () => {
    // 15:00-17:00 and 17:00-19:00 do not overlap; the second reuses the lane.
    const items = layoutColumn([span(15, 17), span(17, 19)], DAY_START, DAY_END);
    expect(items.every((i) => i.width === 100)).toBe(true);
  });

  it("splits three mutually overlapping bookings into thirds", () => {
    const items = layoutColumn([span(15, 18), span(16, 19), span(17, 20)], DAY_START, DAY_END);
    expect(items.every((i) => Math.round(i.width) === 33)).toBe(true);
    expect(new Set(items.map((i) => i.lane)).size).toBe(3);
  });

  /**
   * Clustering matters: a booking that overlaps nothing should not be squeezed
   * because two *other* bookings elsewhere in the day overlap each other.
   */
  it("does not narrow an unrelated booking elsewhere in the day", () => {
    const items = layoutColumn(
      [span(9, 10), span(15, 17), span(16, 18)],
      DAY_START,
      DAY_END,
    );
    const morning = items.find((i) => i.event.startMinutes === 9 * 60)!;
    expect(morning.width).toBe(100);

    const afternoon = items.filter((i) => i.event.startMinutes >= 15 * 60);
    expect(afternoon.every((i) => i.width === 50)).toBe(true);
  });

  it("reuses a freed lane inside a cluster", () => {
    // A 15-17 and B 16-18 overlap; C 17:30-19 can reuse A's lane.
    const items = layoutColumn(
      [span(15, 17), span(16, 18), { startMinutes: 17.5 * 60, endMinutes: 19 * 60 }],
      DAY_START,
      DAY_END,
    );
    expect(items).toHaveLength(3);
    // All three are one transitive cluster, so two lanes are enough.
    expect(new Set(items.map((i) => i.lane)).size).toBe(2);
  });

  it("clips a booking that starts before the rendered window", () => {
    const [item] = layoutColumn([span(4, 8)], DAY_START, DAY_END);
    expect(item.top).toBe(0);
    // Only 06:00-08:00 is visible: two of sixteen hours.
    expect(item.height).toBeCloseTo((2 / 16) * 100, 5);
  });

  it("clips a booking that runs past the rendered window", () => {
    const [item] = layoutColumn([span(21, 24)], DAY_START, DAY_END);
    expect(item.top + item.height).toBeCloseTo(100, 5);
  });

  it("gives a very short booking a clickable minimum height", () => {
    const [item] = layoutColumn(
      [{ startMinutes: 15 * 60, endMinutes: 15 * 60 + 10 }],
      DAY_START,
      DAY_END,
    );
    expect(item.height).toBeGreaterThanOrEqual(1.5);
  });

  it("returns nothing for an empty column", () => {
    expect(layoutColumn([], DAY_START, DAY_END)).toEqual([]);
  });
});

describe("grid bounds", () => {
  it("uses the facility's published hours when nothing extends past them", () => {
    const bounds = gridBounds([span(15, 17)], DAY_START, DAY_END);
    expect(bounds.startMinutes).toBe(DAY_START);
    expect(bounds.endMinutes).toBe(DAY_END);
  });

  it("stretches to include an out-of-hours booking", () => {
    // An admin override put something at 05:15; the grid must still show it.
    const bounds = gridBounds(
      [{ startMinutes: 5 * 60 + 15, endMinutes: 7 * 60 }],
      DAY_START,
      DAY_END,
    );
    expect(bounds.startMinutes).toBe(5 * 60);
  });

  it("never renders a window shorter than four hours", () => {
    const bounds = gridBounds([], 9 * 60, 10 * 60);
    expect(bounds.endMinutes - bounds.startMinutes).toBeGreaterThanOrEqual(240);
  });

  it("stays inside the day", () => {
    const bounds = gridBounds([span(22, 24)], DAY_START, DAY_END);
    expect(bounds.endMinutes).toBeLessThanOrEqual(24 * 60);
    expect(bounds.startMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe("drag helpers", () => {
  it("snaps to quarter hours", () => {
    expect(snapMinutes(931)).toBe(930); // 15:31 -> 15:30
    expect(snapMinutes(938)).toBe(945); // 15:38 -> 15:45
  });

  it("formats minutes as a time input value", () => {
    expect(formatMinutes(930)).toBe("15:30");
    expect(formatMinutes(0)).toBe("00:00");
    expect(formatMinutes(1439)).toBe("23:59");
  });

  it("clamps a formatted value into the day", () => {
    expect(formatMinutes(-30)).toBe("00:00");
    expect(formatMinutes(2000)).toBe("24:00");
  });
});
