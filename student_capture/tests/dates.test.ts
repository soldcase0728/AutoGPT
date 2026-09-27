import { describe, expect, it } from "vitest";
import { dateTime, dayLabel, shortDate } from "@/lib/dates";

describe("school-time dates", () => {
  // 01:30 UTC on the 28th is still the evening of the 27th in Detroit.
  const lateEvening = "2026-09-28T01:30:00Z";

  it("prints the school's calendar day, not UTC's", () => {
    expect(dayLabel(lateEvening)).toBe("Sunday, September 27");
    expect(shortDate(lateEvening)).toBe("9/27/2026");
  });

  it("prints the school's clock time", () => {
    expect(dateTime(lateEvening)).toBe("Sep 27, 9:30 PM");
  });
});
