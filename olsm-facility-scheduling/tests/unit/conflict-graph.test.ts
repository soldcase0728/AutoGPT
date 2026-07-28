import { describe, expect, it } from "vitest";
import {
  indexSubSpaces,
  occupiedSubSpaceIds,
  paddedWindow,
  subSpacesConflict,
  type SubSpaceNode,
} from "@/domain/conflict-graph";

const DOMBROWSKI = "fac-dombrowski";
const TRACK = "fac-track";
const STADIUM = "fac-stadium";

const nodes: SubSpaceNode[] = [
  { id: "full-floor", name: "Full floor", facilityId: DOMBROWSKI, blocksIds: ["court-a", "court-b"] },
  { id: "court-a", name: "Court A", facilityId: DOMBROWSKI, blocksIds: [] },
  { id: "court-b", name: "Court B", facilityId: DOMBROWSKI, blocksIds: [] },
  { id: "cages", name: "Batting cages", facilityId: DOMBROWSKI, blocksIds: [], bufferMinutes: 25 },
  // Cross-facility adjacency: the stadium field closes the running track.
  { id: "stadium-field", name: "Field", facilityId: STADIUM, blocksIds: ["track-full"] },
  { id: "track-full", name: "Full track", facilityId: TRACK, blocksIds: ["lanes-1-4", "lanes-5-8"] },
  { id: "lanes-1-4", name: "Lanes 1–4", facilityId: TRACK, blocksIds: [] },
  { id: "lanes-5-8", name: "Lanes 5–8", facilityId: TRACK, blocksIds: [] },
];

const index = indexSubSpaces(nodes);

describe("conflict graph", () => {
  it("expands a container into everything it occupies", () => {
    expect(occupiedSubSpaceIds("full-floor", index).sort()).toEqual(
      ["court-a", "court-b", "full-floor"].sort(),
    );
  });

  it("does not expand a leaf beyond itself", () => {
    expect(occupiedSubSpaceIds("court-a", index)).toEqual(["court-a"]);
  });

  // Acceptance criterion 5.
  it("blocks Court A and Court B when the full floor is booked", () => {
    expect(subSpacesConflict("full-floor", "court-a", index)).toBe(true);
    expect(subSpacesConflict("full-floor", "court-b", index)).toBe(true);
  });

  it("lets Court A and Court B coexist", () => {
    expect(subSpacesConflict("court-a", "court-b", index)).toBe(false);
  });

  it("is symmetric even though blocking is declared one way", () => {
    // Court A never mentions the full floor, but booking it must still stop a
    // full-floor booking.
    expect(subSpacesConflict("court-a", "full-floor", index)).toBe(true);
  });

  it("follows containment transitively across facilities", () => {
    // Stadium field -> full track -> individual lanes.
    const occupied = occupiedSubSpaceIds("stadium-field", index);
    expect(occupied).toContain("track-full");
    expect(occupied).toContain("lanes-1-4");
    expect(occupied).toContain("lanes-5-8");
    expect(subSpacesConflict("stadium-field", "lanes-5-8", index)).toBe(true);
  });

  it("leaves unrelated spaces alone", () => {
    expect(subSpacesConflict("cages", "court-a", index)).toBe(false);
    expect(subSpacesConflict("stadium-field", "cages", index)).toBe(false);
  });

  it("terminates on a cyclic graph", () => {
    const cyclic = indexSubSpaces([
      { id: "a", name: "A", facilityId: "f", blocksIds: ["b"] },
      { id: "b", name: "B", facilityId: "f", blocksIds: ["a"] },
    ]);
    expect(occupiedSubSpaceIds("a", cyclic).sort()).toEqual(["a", "b"]);
  });

  describe("buffer padding", () => {
    const facilityBuffers = new Map([
      [DOMBROWSKI, 20],
      [TRACK, 10],
      [STADIUM, 30],
    ]);

    it("pads by the facility buffer", () => {
      const start = new Date("2026-01-06T20:00:00Z");
      const end = new Date("2026-01-06T22:00:00Z");
      const padded = paddedWindow(start, end, ["court-a"], index, facilityBuffers);
      expect(padded.bufferMinutes).toBe(20);
      expect(padded.start.toISOString()).toBe("2026-01-06T19:40:00.000Z");
      expect(padded.end.toISOString()).toBe("2026-01-06T22:20:00.000Z");
    });

    it("takes the largest buffer across every occupied space", () => {
      const start = new Date("2026-01-06T20:00:00Z");
      const end = new Date("2026-01-06T22:00:00Z");
      // The stadium (30) reaches the track (10); the larger wins.
      const padded = paddedWindow(
        start,
        end,
        occupiedSubSpaceIds("stadium-field", index),
        index,
        facilityBuffers,
      );
      expect(padded.bufferMinutes).toBe(30);
    });

    it("prefers a sub-space override over the facility default", () => {
      const start = new Date("2026-01-06T20:00:00Z");
      const end = new Date("2026-01-06T21:00:00Z");
      const padded = paddedWindow(start, end, ["cages"], index, facilityBuffers);
      expect(padded.bufferMinutes).toBe(25);
    });
  });
});
