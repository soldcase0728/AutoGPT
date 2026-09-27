import { describe, expect, it } from "vitest";
import { QUEUE_TABS, nextSelection, resolveTab, searchTerm } from "@/lib/queue";

describe("resolveTab", () => {
  it("defaults to To review", () => {
    expect(resolveTab().id).toBe("review");
    expect(resolveTab("nonsense").id).toBe("review");
  });

  it("maps old ?state= links onto tabs", () => {
    expect(resolveTab(undefined, "published").id).toBe("posted");
    expect(resolveTab(undefined, "changes_requested").id).toBe("waiting");
    expect(resolveTab("rejected", "published").id).toBe("rejected");
  });

  it("puts every reviewable state in exactly one tab", () => {
    const states = QUEUE_TABS.flatMap((tab) => tab.states);
    expect(new Set(states).size).toBe(states.length);
  });
});

describe("searchTerm", () => {
  it("keeps names and titles", () => {
    expect(searchTerm("  Jo Mercer ")).toBe("Jo Mercer");
    expect(searchTerm("O’Neil")).toBe("O’Neil");
  });

  it("strips characters that could alter a PostgREST filter", () => {
    expect(searchTerm("a,b),state.eq.published")).toBe("a b state eq published");
    expect(searchTerm("%_*")).toBeNull();
  });

  it("ignores one-letter searches", () => {
    expect(searchTerm("a")).toBeNull();
  });
});

describe("nextSelection", () => {
  const ids = ["a", "b", "c"];

  it("moves to the next item by ID", () => {
    expect(nextSelection(ids, "a")).toBe("b");
  });

  it("falls back to the previous item at the end", () => {
    expect(nextSelection(ids, "c")).toBe("b");
  });

  it("returns null when the list empties", () => {
    expect(nextSelection(["a"], "a")).toBeNull();
  });
});
