import { describe, expect, it } from "vitest";
import { needsParticipantWaivers, parseRoster } from "@/services/participant-service";

describe("roster parsing", () => {
  it("reads a simple name-and-email list", () => {
    const { entries, errors } = parseRoster("Jane Smith, jane@example.com\nBob Jones, bob@example.com");
    expect(errors).toHaveLength(0);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ name: "Jane Smith", email: "jane@example.com", isMinor: false });
  });

  it("accepts a name on its own", () => {
    const { entries } = parseRoster("Jane Smith");
    expect(entries).toEqual([{ name: "Jane Smith", email: undefined, isMinor: false, guardianName: undefined, guardianEmail: undefined }]);
  });

  it("skips a header row", () => {
    const { entries } = parseRoster("name,email,minor\nJane Smith,jane@example.com,no");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Jane Smith");
  });

  it("handles tab-separated paste from a spreadsheet", () => {
    const { entries } = parseRoster("Jane Smith\tjane@example.com");
    expect(entries[0]).toMatchObject({ name: "Jane Smith", email: "jane@example.com" });
  });

  it("captures a minor and their guardian", () => {
    const { entries, errors } = parseRoster("Sam Smith,,yes,Jane Smith,jane@example.com");
    expect(errors).toHaveLength(0);
    expect(entries[0]).toMatchObject({
      name: "Sam Smith",
      isMinor: true,
      guardianName: "Jane Smith",
      guardianEmail: "jane@example.com",
    });
  });

  /**
   * A minor with nobody to sign for them cannot produce a valid waiver, so this
   * has to fail at upload rather than being discovered at the door.
   */
  it("rejects a minor with no guardian", () => {
    const { entries, errors } = parseRoster("Sam Smith,,yes");
    expect(entries).toHaveLength(0);
    expect(errors[0]).toMatch(/marked as a minor but has no parent or guardian/i);
  });

  it("rejects an unparseable email rather than silently dropping it", () => {
    const { entries, errors } = parseRoster("Jane Smith, not-an-email");
    expect(entries).toHaveLength(0);
    expect(errors[0]).toMatch(/does not look like an email/i);
  });

  it("drops duplicates and says so", () => {
    const { entries, errors } = parseRoster(
      "Jane Smith, jane@example.com\nJane Smith, jane@example.com",
    );
    expect(entries).toHaveLength(1);
    expect(errors[0]).toMatch(/appears more than once/i);
  });

  it("treats the same name with different emails as two people", () => {
    const { entries } = parseRoster(
      "Jane Smith, jane@example.com\nJane Smith, jane.smith@work.example",
    );
    expect(entries).toHaveLength(2);
  });

  it("ignores blank lines and stray whitespace", () => {
    const { entries } = parseRoster("\n  Jane Smith , jane@example.com  \n\n\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Jane Smith");
  });

  it("keeps good rows when a bad one is present", () => {
    const { entries, errors } = parseRoster(
      "Jane Smith, jane@example.com\nSam Smith,,yes\nBob Jones, bob@example.com",
    );
    expect(entries.map((e) => e.name)).toEqual(["Jane Smith", "Bob Jones"]);
    expect(errors).toHaveLength(1);
  });

  it("accepts several ways of saying yes", () => {
    for (const yes of ["yes", "Y", "TRUE", "minor", "1"]) {
      const { entries } = parseRoster(`Sam,,${yes},Jane Smith`);
      expect(entries[0].isMinor, `"${yes}" should mean minor`).toBe(true);
    }
  });
});

describe("which activities need participant waivers", () => {
  it("covers paid, external and camp use", () => {
    expect(needsParticipantWaivers("SCHOOL_CAMP")).toBe(true);
    expect(needsParticipantWaivers("PRIVATE_INSTRUCTION")).toBe(true);
    expect(needsParticipantWaivers("CLUB_TRAVEL")).toBe(true);
    expect(needsParticipantWaivers("EXTERNAL_RENTAL")).toBe(true);
  });

  /**
   * Team activity is covered by the Annual Coach Agreement plus the school's
   * own athletic paperwork; asking a varsity roster to re-sign for every
   * practice would be friction with no liability benefit.
   */
  it("does not apply to team activity", () => {
    expect(needsParticipantWaivers("TEAM_PRACTICE")).toBe(false);
    expect(needsParticipantWaivers("CONTEST")).toBe(false);
    expect(needsParticipantWaivers("SCHOOL_EVENT")).toBe(false);
    expect(needsParticipantWaivers("MAINTENANCE")).toBe(false);
  });
});
