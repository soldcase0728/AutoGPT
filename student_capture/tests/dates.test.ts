import { describe, expect, it } from "vitest";
import { beforeCutoff, cutoffFor, dateTime, dayLabel, schoolHour, schoolToday, shortDate } from "@/lib/dates";

describe("school-time dates", () => {
  // 01:30 UTC on the 28th is still the evening of the 27th in Detroit.
  const lateEvening = "2026-09-28T01:30:00Z";

  it("prints the school's calendar day, not UTC's", () => {
    expect(dayLabel(lateEvening)).toBe("Sunday, September 27");
    expect(shortDate(lateEvening)).toBe("9/27/2026");
  });

  it("prints a bare date as that day, not the evening before", () => {
    expect(dayLabel("2026-09-28")).toBe("Monday, September 28");
    expect(shortDate("2026-09-28")).toBe("9/28/2026");
  });

  it("prints the school's clock time", () => {
    expect(dateTime(lateEvening)).toBe("Sep 27, 9:30 PM");
  });

  it("knows today's date and hour at school", () => {
    expect(schoolToday(lateEvening)).toBe("2026-09-27");
    expect(schoolHour(lateEvening)).toBe(21);
    expect(schoolToday("2026-09-28T04:30:00Z")).toBe("2026-09-28");
  });
});

describe("the 9 pm cutoff", () => {
  it("is 9:00 pm Detroit time in daylight time and standard time", () => {
    expect(cutoffFor("2026-09-27").toISOString()).toBe("2026-09-28T01:00:00.000Z");
    expect(cutoffFor("2026-12-01").toISOString()).toBe("2026-12-02T02:00:00.000Z");
  });

  it("is open until 9 pm and closed from then on", () => {
    expect(beforeCutoff("2026-09-27", "2026-09-28T00:59:59Z")).toBe(true);
    expect(beforeCutoff("2026-09-27", "2026-09-28T01:00:00Z")).toBe(false);
  });
});
