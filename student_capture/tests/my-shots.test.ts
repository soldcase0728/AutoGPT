import { describe, expect, it } from "vitest";
import { resolveShotsTab, shotBucket, splitShots } from "@/lib/my-shots";

describe("shotBucket", () => {
  it("puts anything the student still has to do under open", () => {
    expect(["assigned", "uploading", "changes_requested", "reshooting"].map(shotBucket)).toEqual(["open", "open", "open", "open"]);
  });

  it("puts sent shots under done, whatever came of them", () => {
    expect(["submitted", "in_review", "approved", "published", "rejected", "taken_down", "withdrawn"].map(shotBucket))
      .toEqual(Array(7).fill("done"));
  });

  it("keeps missed tasks apart", () => {
    expect(shotBucket("expired")).toBe("missed");
  });
});

describe("resolveShotsTab", () => {
  it("honours the link", () => {
    expect(resolveShotsTab("done", 3)).toBe("done");
  });

  it("lands on open tasks when there are some, else on sent shots", () => {
    expect(resolveShotsTab(null, 2)).toBe("open");
    expect(resolveShotsTab("nonsense", 0)).toBe("done");
  });
});

describe("splitShots", () => {
  it("orders open soonest first and sent newest first", () => {
    const { open, done, missed } = splitShots([
      { state: "assigned", occurredAt: "2026-09-30T12:00:00" },
      { state: "published", occurredAt: "2026-09-20T10:00:00" },
      { state: "assigned", occurredAt: "2026-09-28T12:00:00" },
      { state: "approved", occurredAt: "2026-09-25T10:00:00" },
      { state: "expired", occurredAt: "2026-09-21T12:00:00" },
    ]);
    expect(open.map((r) => r.occurredAt.slice(0, 10))).toEqual(["2026-09-28", "2026-09-30"]);
    expect(done.map((r) => r.state)).toEqual(["approved", "published"]);
    expect(missed).toHaveLength(1);
  });
});
