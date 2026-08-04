/**
 * Acceptance criterion 6: season allocation surfaces every collision before
 * publishing, and nothing publishes until each one is resolved.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApprovalStatus, BookingStatus, SeasonCode, TeamLevel } from "@prisma/client";
import {
  actorFor,
  db,
  ensureMigrated,
  reseedAgreements,
  resetTransactionalData,
  subSpace,
  userByEmail,
} from "../helpers/db";
import {
  createStandingBlock,
  decideStandingBlockRequest,
  previewSeasonAllocation,
  previewStandingBlockRequest,
  publishSeasonAllocation,
  requestStandingBlock,
  withdrawStandingBlockRequest,
} from "@/services/allocation-service";
import { createBooking, releaseStandingBlockOccurrence } from "@/services/booking-service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { localToInstant } from "@/lib/time";

beforeAll(() => {
  ensureMigrated();
});

beforeEach(async () => {
  await resetTransactionalData();
  await db.document.deleteMany({});
  await reseedAgreements();
  await db.season.deleteMany({ where: { name: { startsWith: "TEST " } } });
});

/** A short two-week season so expansions stay fast and predictable. */
async function makeSeason(name: string, startISO: string, endISO: string) {
  return db.season.create({
    data: {
      name: `TEST ${name}`,
      seasonCode: SeasonCode.WINTER,
      startDate: new Date(`${startISO}T00:00:00Z`),
      endDate: new Date(`${endISO}T00:00:00Z`),
    },
  });
}

describe("season allocation", () => {
  it("expands standing blocks into every occurrence", async () => {
    const season = await makeSeason("expand", "2027-01-04", "2027-01-15");
    const head = await userByEmail("bball.head@olsm.edu");
    const sport = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const court = await subSpace("rakoczy-gymnasium", "full-court");

    await createStandingBlock(
      {
        seasonId: season.id,
        sportId: sport.id,
        subSpaceId: court.id,
        teamLevel: TeamLevel.VARSITY,
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        startTime: "15:30",
        endTime: "17:30",
        createdById: head.id,
      },
      actorFor(head),
    );

    const preview = await previewSeasonAllocation(season.id);
    expect(preview.occurrences).toHaveLength(10); // two full weekday weeks
    expect(preview.report.publishable).toBe(true);
  });

  it("surfaces every collision between two sports sharing a space", async () => {
    const season = await makeSeason("collide", "2027-01-04", "2027-01-15");
    const boysHead = await userByEmail("bball.head@olsm.edu");
    const girlsHead = await userByEmail("gbball.head@olsm.edu");
    const boys = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const girls = await db.sport.findUniqueOrThrow({ where: { name: "Girls Basketball" } });

    const fullCourt = await subSpace("rakoczy-gymnasium", "full-court");
    const courtOne = await subSpace("rakoczy-gymnasium", "court-1");

    await createStandingBlock(
      {
        seasonId: season.id,
        sportId: boys.id,
        subSpaceId: fullCourt.id,
        teamLevel: TeamLevel.VARSITY,
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
        startTime: "15:30",
        endTime: "17:30",
        createdById: boysHead.id,
      },
      actorFor(boysHead),
    );

    // Court 1 is inside the full court, so this collides even though the
    // sub-space ids differ.
    await createStandingBlock(
      {
        seasonId: season.id,
        sportId: girls.id,
        subSpaceId: courtOne.id,
        teamLevel: TeamLevel.VARSITY,
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
        startTime: "16:30",
        endTime: "18:30",
        createdById: girlsHead.id,
      },
      actorFor(girlsHead),
    );

    const preview = await previewSeasonAllocation(season.id);
    expect(preview.report.publishable).toBe(false);
    // Two Mondays and two Wednesdays overlap in the window.
    expect(preview.report.collisions).toHaveLength(4);
    expect(preview.report.affectedBlockIds).toHaveLength(2);
    expect(preview.report.collisions[0].sharedSubSpaceIds).toContain(courtOne.id);
  });

  it("refuses to publish while a collision is unresolved", async () => {
    const season = await makeSeason("refuse", "2027-01-04", "2027-01-08");
    const boysHead = await userByEmail("bball.head@olsm.edu");
    const girlsHead = await userByEmail("gbball.head@olsm.edu");
    const boys = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const girls = await db.sport.findUniqueOrThrow({ where: { name: "Girls Basketball" } });
    const fullCourt = await subSpace("rakoczy-gymnasium", "full-court");
    const courtTwo = await subSpace("rakoczy-gymnasium", "court-2");

    for (const [sport, sub, coach] of [
      [boys, fullCourt, boysHead],
      [girls, courtTwo, girlsHead],
    ] as const) {
      await createStandingBlock(
        {
          seasonId: season.id,
          sportId: sport.id,
          subSpaceId: sub.id,
          teamLevel: TeamLevel.VARSITY,
          rrule: "FREQ=WEEKLY;BYDAY=TU",
          startTime: "15:30",
          endTime: "17:30",
          createdById: coach.id,
        },
        actorFor(coach),
      );
    }

    const admin = await userByEmail("ad@olsm.edu");
    await expect(publishSeasonAllocation(season.id, actorFor(admin))).rejects.toBeInstanceOf(
      ValidationError,
    );

    // Nothing was written.
    expect(await db.booking.count({ where: { seasonId: season.id } })).toBe(0);
    const stillUnpublished = await db.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(stillUnpublished.published).toBe(false);
  });

  it("publishes a clean allocation as real bookings", async () => {
    const season = await makeSeason("publish", "2027-01-04", "2027-01-08");
    const boysHead = await userByEmail("bball.head@olsm.edu");
    const girlsHead = await userByEmail("gbball.head@olsm.edu");
    const boys = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const girls = await db.sport.findUniqueOrThrow({ where: { name: "Girls Basketball" } });
    const admin = await userByEmail("ad@olsm.edu");

    // The two halves of the gym, running simultaneously: no collision.
    const courtOne = await subSpace("rakoczy-gymnasium", "court-1");
    const courtTwo = await subSpace("rakoczy-gymnasium", "court-2");

    for (const [sport, sub, coach] of [
      [boys, courtOne, boysHead],
      [girls, courtTwo, girlsHead],
    ] as const) {
      await createStandingBlock(
        {
          seasonId: season.id,
          sportId: sport.id,
          subSpaceId: sub.id,
          teamLevel: TeamLevel.VARSITY,
          rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
          startTime: "15:30",
          endTime: "17:30",
          createdById: coach.id,
        },
        actorFor(coach),
      );
    }

    const result = await publishSeasonAllocation(season.id, actorFor(admin));
    expect(result.skipped).toHaveLength(0);
    expect(result.created).toBe(10); // 5 weekdays x 2 courts

    const bookings = await db.booking.findMany({ where: { seasonId: season.id } });
    expect(bookings).toHaveLength(10);
    expect(bookings.every((b) => b.status === BookingStatus.CONFIRMED)).toBe(true);

    const published = await db.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(published.published).toBe(true);
  });

  it("lets a head coach release a day they do not need, freeing the slot", async () => {
    const season = await makeSeason("release", "2027-01-04", "2027-01-05");
    const head = await userByEmail("bball.head@olsm.edu");
    const other = await userByEmail("gbball.head@olsm.edu");
    const admin = await userByEmail("ad@olsm.edu");
    const sport = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const court = await subSpace("dombrowski-fieldhouse", "court-a");

    await createStandingBlock(
      {
        seasonId: season.id,
        sportId: sport.id,
        subSpaceId: court.id,
        teamLevel: TeamLevel.VARSITY,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        startTime: "15:30",
        endTime: "17:30",
        createdById: head.id,
      },
      actorFor(head),
    );

    await publishSeasonAllocation(season.id, actorFor(admin));
    const booking = await db.booking.findFirstOrThrow({ where: { seasonId: season.id } });

    // Someone on the waitlist for that window.
    await db.waitlistEntry.create({
      data: {
        subSpaceId: court.id,
        userId: other.id,
        windowStart: booking.startAt,
        windowEnd: booking.endAt,
        activityType: "TEAM_PRACTICE",
      },
    });

    await releaseStandingBlockOccurrence(booking.id, actorFor(head));

    const released = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(released.status).toBe(BookingStatus.CANCELLED);
    expect(await db.bookingOccupancy.count({ where: { bookingId: booking.id } })).toBe(0);

    // The waitlisted coach was told.
    const entry = await db.waitlistEntry.findFirstOrThrow({ where: { userId: other.id } });
    expect(entry.notifiedAt).not.toBeNull();
    const email = await db.jobQueue.findFirst({
      where: { kind: "notify.email", idempotencyKey: { startsWith: `waitlist:${entry.id}` } },
    });
    expect(email).not.toBeNull();
  });
});

describe("coach-requested standing blocks", () => {
  async function requestFor(
    seasonId: string,
    overrides: Partial<Parameters<typeof requestStandingBlock>[0]> = {},
    email = "bball.head@olsm.edu",
  ) {
    const head = await userByEmail(email);
    const sport = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const court = await subSpace("rakoczy-gymnasium", "full-court");

    return requestStandingBlock(
      {
        seasonId,
        sportId: sport.id,
        subSpaceId: court.id,
        teamLevel: TeamLevel.VARSITY,
        rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
        startTime: "15:30",
        endTime: "17:30",
        ...overrides,
      },
      actorFor(head),
    );
  }

  it("creates a pending request that stays out of the season preview", async () => {
    const season = await makeSeason("request", "2027-01-04", "2027-01-15");
    const block = await requestFor(season.id, { requestNote: "Districts start mid-February." });

    expect(block.status).toBe(ApprovalStatus.PENDING);
    expect(block.published).toBe(false);
    expect(block.requestNote).toBe("Districts start mid-February.");

    // Undecided requests neither expand nor collide.
    const preview = await previewSeasonAllocation(season.id);
    expect(preview.occurrences).toHaveLength(0);
    expect(preview.report.publishable).toBe(true);

    // The athletic office was told there is something to review.
    const email = await db.jobQueue.findFirst({
      where: {
        kind: "notify.email",
        idempotencyKey: { startsWith: `notify:admin:standing-block-request:${block.id}` },
      },
    });
    expect(email).not.toBeNull();
  });

  it("refuses a request from anyone but the sport's head coach", async () => {
    const season = await makeSeason("wrong-coach", "2027-01-04", "2027-01-15");

    // The assistant is on the right team but does not hold the season.
    await expect(
      requestFor(season.id, {}, "bball.assistant@olsm.edu"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // The girls' head coach holds a different sport.
    await expect(requestFor(season.id, {}, "gbball.head@olsm.edu")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects dates that miss the season entirely, and clamps ones that spill", async () => {
    const season = await makeSeason("bounds", "2027-01-04", "2027-01-15");

    await expect(
      requestFor(season.id, { startDate: "2027-02-01", endDate: "2027-02-28" }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Spilling past the edges is a coach not knowing the exact season dates,
    // not a mistake: expansion clamps to the season.
    const block = await requestFor(season.id, { startDate: "2026-12-25", endDate: "2027-01-08" });
    const admin = await userByEmail("ad@olsm.edu");
    await decideStandingBlockRequest(block.id, "APPROVED", actorFor(admin));

    const preview = await previewSeasonAllocation(season.id);
    // Tue/Thu between Jan 4 and Jan 8: Jan 5 and Jan 7 only.
    expect(preview.occurrences.map((o) => o.date)).toEqual(["2027-01-05", "2027-01-07"]);
  });

  it("denies only with a reason, which reaches the coach verbatim", async () => {
    const season = await makeSeason("deny", "2027-01-04", "2027-01-15");
    const block = await requestFor(season.id);
    const admin = await userByEmail("ad@olsm.edu");

    await expect(
      decideStandingBlockRequest(block.id, "DENIED", actorFor(admin)),
    ).rejects.toBeInstanceOf(ValidationError);

    const result = await decideStandingBlockRequest(
      block.id,
      "DENIED",
      actorFor(admin),
      "The gym is committed to volleyball then. Ask for the fieldhouse.",
    );
    expect(result.status).toBe("DENIED");

    const denied = await db.standingBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(denied.status).toBe(ApprovalStatus.DENIED);
    expect(denied.decisionNote).toContain("volleyball");
    expect(denied.decidedById).not.toBeNull();

    // Still shapes nothing.
    const preview = await previewSeasonAllocation(season.id);
    expect(preview.occurrences).toHaveLength(0);

    // And cannot be decided twice.
    await expect(
      decideStandingBlockRequest(block.id, "APPROVED", actorFor(admin)),
    ).rejects.toBeInstanceOf(ValidationError);

    const email = await db.jobQueue.findFirst({
      where: { kind: "notify.email", idempotencyKey: `notify:standing-block:${block.id}:DENIED` },
    });
    expect(email).not.toBeNull();
  });

  it("keeps the decision with the athletic office", async () => {
    const season = await makeSeason("not-yours", "2027-01-04", "2027-01-15");
    const block = await requestFor(season.id);
    const otherCoach = await userByEmail("gbball.head@olsm.edu");

    await expect(
      decideStandingBlockRequest(block.id, "APPROVED", actorFor(otherCoach)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("approves into a draft season, which then publishes the block's bookings", async () => {
    const season = await makeSeason("approve-draft", "2027-01-04", "2027-01-15");
    const head = await userByEmail("bball.head@olsm.edu");
    const admin = await userByEmail("ad@olsm.edu");
    const block = await requestFor(season.id);

    const result = await decideStandingBlockRequest(block.id, "APPROVED", actorFor(admin));
    expect(result.awaitingSeasonPublish).toBe(true);
    expect(result.created).toBe(0);

    // Approved but not yet published: visible in the preview, not on the calendar.
    const preview = await previewSeasonAllocation(season.id);
    expect(preview.occurrences).toHaveLength(4); // Tue/Thu across two weeks
    expect(await db.booking.count({ where: { standingBlockId: block.id } })).toBe(0);

    const published = await publishSeasonAllocation(season.id, actorFor(admin));
    expect(published.created).toBe(4);

    const bookings = await db.booking.findMany({ where: { standingBlockId: block.id } });
    expect(bookings).toHaveLength(4);
    expect(bookings.every((b) => b.status === BookingStatus.CONFIRMED)).toBe(true);
    expect(bookings.every((b) => b.requesterId === head.id)).toBe(true);
  });

  it("approving into a published season books every clear day and reports the rest", async () => {
    const season = await makeSeason("approve-live", "2027-01-04", "2027-01-15");
    const admin = await userByEmail("ad@olsm.edu");
    const otherHead = await userByEmail("gbball.head@olsm.edu");
    const girls = await db.sport.findUniqueOrThrow({ where: { name: "Girls Basketball" } });
    const courtOne = await subSpace("rakoczy-gymnasium", "court-1");

    // The season is already on the calendar.
    await publishSeasonAllocation(season.id, actorFor(admin));

    // Girls' practice already holds half the gym on the first Tuesday, at the
    // same priority, so the full-court request cannot bump it.
    await createBooking(
      {
        requesterId: otherHead.id,
        subSpaceId: courtOne.id,
        activityType: "TEAM_PRACTICE",
        title: "Girls varsity practice",
        startAt: localToInstant("2027-01-05", "16:00"),
        endAt: localToInstant("2027-01-05", "17:00"),
        sportId: girls.id,
        teamLevel: TeamLevel.VARSITY,
      },
      actorFor(otherHead),
    );

    const block = await requestFor(season.id);
    const result = await decideStandingBlockRequest(block.id, "APPROVED", actorFor(admin));

    expect(result.awaitingSeasonPublish).toBe(false);
    expect(result.created).toBe(3);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].date).toBe("2027-01-05");

    const updated = await db.standingBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(updated.status).toBe(ApprovalStatus.APPROVED);
    expect(updated.published).toBe(true);

    const bookings = await db.booking.findMany({
      where: { standingBlockId: block.id },
      orderBy: { startAt: "asc" },
    });
    expect(bookings).toHaveLength(3);
    expect(bookings.every((b) => b.status === BookingStatus.CONFIRMED)).toBe(true);

    // The coach's notice names the day that could not be booked.
    const email = await db.jobQueue.findFirstOrThrow({
      where: { kind: "notify.email", idempotencyKey: `notify:standing-block:${block.id}:APPROVED` },
    });
    expect(JSON.stringify(email.payload)).toContain("2027-01-05");
  });

  it("shows the reviewer what a request collides with before they decide", async () => {
    const season = await makeSeason("preview-request", "2027-01-04", "2027-01-15");
    const admin = await userByEmail("ad@olsm.edu");
    const girlsHead = await userByEmail("gbball.head@olsm.edu");
    const girls = await db.sport.findUniqueOrThrow({ where: { name: "Girls Basketball" } });
    const courtOne = await subSpace("rakoczy-gymnasium", "court-1");

    // An approved (not yet published) girls block on Court 1, Tuesdays.
    await createStandingBlock(
      {
        seasonId: season.id,
        sportId: girls.id,
        subSpaceId: courtOne.id,
        teamLevel: TeamLevel.VARSITY,
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        startTime: "16:00",
        endTime: "18:00",
        createdById: girlsHead.id,
      },
      actorFor(admin),
    );

    // A full-court request on Tue/Thu overlaps it every Tuesday.
    const block = await requestFor(season.id);
    const preview = await previewStandingBlockRequest(block.id);

    expect(preview.sessions).toBe(4);
    expect(preview.firstDate).toBe("2027-01-05");
    expect(preview.collisionCount).toBe(2); // the two Tuesdays
    expect(preview.collisions[0].withLabel).toContain("Girls Basketball");
  });

  it("lets the coach withdraw a request nobody has decided", async () => {
    const season = await makeSeason("withdraw", "2027-01-04", "2027-01-15");
    const head = await userByEmail("bball.head@olsm.edu");
    const otherCoach = await userByEmail("gbball.head@olsm.edu");
    const admin = await userByEmail("ad@olsm.edu");

    const first = await requestFor(season.id);
    await expect(
      withdrawStandingBlockRequest(first.id, actorFor(otherCoach)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await withdrawStandingBlockRequest(first.id, actorFor(head));
    expect(await db.standingBlock.findUnique({ where: { id: first.id } })).toBeNull();

    // Once decided, it is no longer the coach's to take back.
    const second = await requestFor(season.id);
    await decideStandingBlockRequest(second.id, "APPROVED", actorFor(admin));
    await expect(withdrawStandingBlockRequest(second.id, actorFor(head))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("publishing a season leaves pending requests untouched", async () => {
    const season = await makeSeason("publish-pending", "2027-01-04", "2027-01-15");
    const admin = await userByEmail("ad@olsm.edu");
    const block = await requestFor(season.id);

    await publishSeasonAllocation(season.id, actorFor(admin));

    const untouched = await db.standingBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(untouched.status).toBe(ApprovalStatus.PENDING);
    expect(untouched.published).toBe(false);
    expect(await db.booking.count({ where: { standingBlockId: block.id } })).toBe(0);
  });
  // Boundaries nothing else guards. Each of these is a way the feature could
  // quietly stop being safe without a single existing test turning red.

  it("does not let one coach withdraw another coach's request", async () => {
    const season = await makeSeason("cross-withdraw", "2027-01-04", "2027-01-15");
    const block = await requestFor(season.id);
    const otherCoach = await userByEmail("gbball.head@olsm.edu");

    await expect(
      withdrawStandingBlockRequest(block.id, actorFor(otherCoach)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.standingBlock.count({ where: { id: block.id } })).toBe(1);
  });

  it("does not let a coach decide their own request", async () => {
    const season = await makeSeason("self-approve", "2027-01-04", "2027-01-15");
    const block = await requestFor(season.id);
    const head = await userByEmail("bball.head@olsm.edu");

    await expect(
      decideStandingBlockRequest(block.id, "APPROVED", actorFor(head)),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const still = await db.standingBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(still.status).toBe(ApprovalStatus.PENDING);
  });

  it("refuses a second decision on a request already decided", async () => {
    // Two administrators with the queue open, or a double submit. The second
    // must not overwrite the first and re-run the booking side effects.
    const season = await makeSeason("decide-twice", "2027-01-04", "2027-01-15");
    const block = await requestFor(season.id);
    const admin = await userByEmail("ad@olsm.edu");

    await decideStandingBlockRequest(block.id, "APPROVED", actorFor(admin));
    await expect(
      decideStandingBlockRequest(block.id, "DENIED", actorFor(admin), "second thoughts"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps a denied request out of the allocation while keeping the record", async () => {
    const season = await makeSeason("denied-inert", "2027-01-04", "2027-01-15");
    const block = await requestFor(season.id);
    const admin = await userByEmail("ad@olsm.edu");

    await decideStandingBlockRequest(
      block.id,
      "DENIED",
      actorFor(admin),
      "The gym is committed to contests on those nights.",
    );

    const preview = await previewSeasonAllocation(season.id);
    expect(preview.occurrences.filter((o) => o.blockId === block.id)).toHaveLength(0);

    const kept = await db.standingBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(kept.status).toBe(ApprovalStatus.DENIED);
    expect(kept.decisionNote).toBe("The gym is committed to contests on those nights.");
  });
});
