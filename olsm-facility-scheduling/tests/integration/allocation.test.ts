/**
 * Acceptance criterion 6: season allocation surfaces every collision before
 * publishing, and nothing publishes until each one is resolved.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BookingStatus, SeasonCode, TeamLevel } from "@prisma/client";
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
  previewSeasonAllocation,
  publishSeasonAllocation,
} from "@/services/allocation-service";
import { releaseStandingBlockOccurrence } from "@/services/booking-service";
import { ValidationError } from "@/lib/errors";

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
