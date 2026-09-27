import { describe, expect, it } from "vitest";
import { parseCommunityStats, parseTeamBoard, recentPost, studentRecord } from "@/lib/student-record";
import type { AssignmentStatus, TaskAssignment } from "@/lib/task-progress";

const a = (id: string, dueOn: string): TaskAssignment => ({ id, personId: "me", dueOn });

describe("studentRecord", () => {
  const assignments = [
    a("mon", "2026-09-21"),
    a("tue", "2026-09-22"),
    a("wed", "2026-09-23"),
    a("thu", "2026-09-24"),
    a("fri", "2026-09-25"),
    a("next", "2026-09-28"),
  ];

  it("counts back from the latest prompt and stops at a miss", () => {
    const statuses = new Map<string, AssignmentStatus>([
      ["mon", "posted"], ["tue", "not_sent"], ["wed", "sent"], ["thu", "rejected"], ["fri", "approved"], ["next", "upcoming"],
    ]);
    expect(studentRecord(assignments, statuses, "2026-09-25", 1)).toEqual({ streak: 3, sent: 4, posted: 1 });
  });

  it("doesn't break the streak for today's prompt while it can still be sent", () => {
    const statuses = new Map<string, AssignmentStatus>([
      ["wed", "sent"], ["thu", "sent"], ["fri", "not_sent"],
    ]);
    expect(studentRecord(assignments, statuses, "2026-09-25", 0).streak).toBe(2);
  });

  it("is zero when the last prompt was missed", () => {
    const statuses = new Map<string, AssignmentStatus>([["thu", "sent"], ["fri", "not_sent"]]);
    expect(studentRecord(assignments, statuses, "2026-09-26", 0).streak).toBe(0);
  });

  it("treats a withdrawn one as a miss", () => {
    const statuses = new Map<string, AssignmentStatus>([["thu", "sent"], ["fri", "withdrawn"]]);
    expect(studentRecord(assignments, statuses, "2026-09-26", 0).streak).toBe(0);
  });
});

describe("recentPost", () => {
  const now = new Date("2026-09-27T12:00:00Z");

  it("picks the newest post from the last week", () => {
    const post = recentPost([
      { id: "old", title: "Old", postedAt: "2026-09-10T12:00:00Z", postUrl: null },
      { id: "a", title: "A", postedAt: "2026-09-24T12:00:00Z", postUrl: null },
      { id: "b", title: "B", postedAt: "2026-09-26T12:00:00Z", postUrl: "https://example.com/p/b" },
    ], now);
    expect(post?.id).toBe("b");
  });

  it("is null when nothing went live recently", () => {
    expect(recentPost([{ id: "old", title: "Old", postedAt: "2026-09-01T12:00:00Z", postUrl: null }], now)).toBeNull();
  });
});

describe("parseCommunityStats", () => {
  it("reads the RPC's shape", () => {
    expect(parseCommunityStats({
      week_posted: 12, week_contributors: 9,
      groups: [{ name: "Varsity soccer", kind: "team", members: 18, week_sent: 11 }],
    })).toEqual({
      weekPosted: 12, weekContributors: 9,
      groups: [{ name: "Varsity soccer", kind: "team", members: 18, weekSent: 11 }],
    });
  });

  it("returns null when the function isn't there", () => {
    expect(parseCommunityStats(null)).toBeNull();
  });

  it("drops malformed groups", () => {
    expect(parseCommunityStats({ week_posted: "3", groups: [{ kind: "team" }, null] })).toEqual({
      weekPosted: 3, weekContributors: 0, groups: [],
    });
  });
});

describe("parseTeamBoard", () => {
  it("reads the RPC's shape", () => {
    expect(parseTeamBoard({
      opted_in: true,
      groups: [{ name: "Varsity soccer", kind: "team", entries: [
        { first_name: "Ali", week_sent: 4, week_posted: 2, me: true },
        { first_name: "Jo", week_sent: "3", week_posted: 0, me: false },
      ] }],
    })).toEqual({
      optedIn: true,
      groups: [{ name: "Varsity soccer", kind: "team", entries: [
        { firstName: "Ali", weekSent: 4, weekPosted: 2, me: true },
        { firstName: "Jo", weekSent: 3, weekPosted: 0, me: false },
      ] }],
    });
  });

  it("treats anything but true as not opted in, and drops nameless entries", () => {
    expect(parseTeamBoard({ opted_in: "yes", groups: [{ name: "G", entries: [{ week_sent: 1 }] }] })).toEqual({
      optedIn: false,
      groups: [{ name: "G", kind: "list", entries: [] }],
    });
  });

  it("returns null when the function isn't there", () => {
    expect(parseTeamBoard(undefined)).toBeNull();
  });
});
