import { describe, expect, it } from "vitest";
import {
  buildChecklist,
  checklistSatisfied,
  requiredIds,
  safetyItems,
} from "@/lib/guidelines";
import type { GuidelineVersion } from "@/lib/types";

const craft: GuidelineVersion = {
  id: "v-craft",
  set_id: "s-craft",
  version: 1,
  body: {
    summary: "Shoot it upright.",
    items: [
      { id: "steady", text: "Brace your elbows.", required: false },
      { id: "vertical", text: "Hold the phone upright.", required: true },
    ],
  },
};

const brand: GuidelineVersion = {
  id: "v-brand",
  set_id: "s-brand",
  version: 3,
  body: {
    summary: "What never goes out.",
    items: [
      { id: "vertical", text: "Duplicated rule, different wording.", required: true },
      { id: "no-records", text: "No grades or ID cards in frame.", required: true },
    ],
  },
};

describe("buildChecklist", () => {
  it("records every version so a capture can cite what it was shot under", () => {
    expect(buildChecklist([craft, brand]).versionIds).toEqual(["v-craft", "v-brand"]);
  });

  it("shows a rule once even when two sets carry it", () => {
    const items = buildChecklist([craft, brand]).items;
    expect(items.filter((i) => i.id === "vertical")).toHaveLength(1);
    expect(items).toHaveLength(3);
  });

  it("puts required rules first, since they gate the camera", () => {
    const items = buildChecklist([craft, brand]).items;
    expect(items.at(-1)?.id).toBe("steady");
    expect(items.slice(0, 2).every((i) => i.required)).toBe(true);
  });

  it("survives a version with no items", () => {
    const empty = { ...craft, body: { summary: "", items: [] } };
    expect(buildChecklist([empty]).items).toEqual([]);
  });
});

describe("checklistSatisfied", () => {
  const checklist = buildChecklist([craft, brand]);

  it("needs every required rule ticked", () => {
    expect(checklistSatisfied(checklist, ["vertical"])).toBe(false);
    expect(checklistSatisfied(checklist, requiredIds(checklist))).toBe(true);
  });

  it("does not care about the optional ones", () => {
    expect(checklistSatisfied(checklist, ["vertical", "no-records"])).toBe(true);
  });
});

// --- kill rule 6 -----------------------------------------------------------

const safetySet: GuidelineVersion = {
  id: "v-safety",
  set_id: "s-craft",
  version: 2,
  body: {
    summary: "Do not get hurt.",
    items: [
      { id: "tone", text: "Talk like a student.", required: false },
      {
        id: "safety",
        text: "Never film while walking, on stairs, or near traffic.",
        required: false, // deliberately understated in the source data
        safety: true,
      },
      { id: "vertical", text: "Hold the phone upright.", required: true },
    ],
  },
};

describe("safety rules (kill rule 6)", () => {
  const checklist = buildChecklist([safetySet]);

  it("is always required, whatever the source data says", () => {
    const safety = checklist.items.find((i) => i.id === "safety");
    expect(safety?.required).toBe(true);
    expect(requiredIds(checklist)).toContain("safety");
  });

  it("is shown first, above every other rule", () => {
    expect(checklist.items[0]?.id).toBe("safety");
  });

  it("is separable so it can be rendered with emphasis", () => {
    expect(safetyItems(checklist).map((i) => i.id)).toEqual(["safety"]);
  });

  it("blocks the camera until it is ticked", () => {
    expect(checklistSatisfied(checklist, ["vertical"])).toBe(false);
    expect(checklistSatisfied(checklist, ["vertical", "safety"])).toBe(true);
  });
});
