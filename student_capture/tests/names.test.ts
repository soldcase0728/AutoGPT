import { describe, expect, it } from "vitest";
import { firstName, shotsHeading } from "@/lib/names";

describe("firstName", () => {
  it("takes the first word of a roster name", () => {
    expect(firstName("Ali Haddad")).toBe("Ali");
    expect(firstName("  Jo   Mercer ")).toBe("Jo");
  });

  it("gives up on names it can't address someone by", () => {
    expect(firstName("C. Castiglione")).toBeNull();
    expect(firstName("J")).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(firstName("sam@example.edu")).toBeNull();
  });
});

describe("shotsHeading", () => {
  it("uses the first name, with the right possessive", () => {
    expect(shotsHeading("Ali Haddad")).toBe("Ali's shots");
    expect(shotsHeading("James Ortiz")).toBe("James' shots");
  });

  it("falls back when there is no usable name", () => {
    expect(shotsHeading("C. Castiglione")).toBe("Your shots");
  });
});

describe("partOfDay", () => {
  it("splits the day at 4am, noon and 5pm", async () => {
    const { partOfDay } = await import("@/components/Greeting");
    expect([3, 4, 11, 12, 16, 17, 23].map(partOfDay)).toEqual([
      "Evening", "Morning", "Morning", "Afternoon", "Afternoon", "Evening", "Evening",
    ]);
  });
});
