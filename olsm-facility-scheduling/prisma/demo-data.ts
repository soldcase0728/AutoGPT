/**
 * Realistic demo data for screenshots and walkthroughs.
 *
 * Fills the current week with the mix of activity the system is actually meant
 * to hold at once: standing team practices, a contest, a paid clinic waiting on
 * paperwork, a club rental waiting on payment, and a camp collecting waivers.
 *
 * Not part of the seed. Run explicitly against a disposable database.
 */

import { PrismaClient } from "@prisma/client";
import { localToInstant, instantToLocalDate, shiftISODate } from "../src/lib/time";
import { createBooking } from "../src/services/booking-service";
import { addRoster, ensureWaiverToken } from "../src/services/participant-service";
import { decideApproval } from "../src/services/booking-service";

const prisma = new PrismaClient();

const DATABASE = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";

async function main() {
  if (!/_demo$|_e2e$|_test$/.test(DATABASE)) {
    throw new Error(`Refusing to run against "${DATABASE}". Use a _demo/_e2e/_test database.`);
  }

  const user = async (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
  const space = async (facilitySlug: string, slug: string) => {
    const facility = await prisma.facility.findUniqueOrThrow({ where: { slug: facilitySlug } });
    return prisma.subSpace.findUniqueOrThrow({
      where: { facilityId_slug: { facilityId: facility.id, slug } },
    });
  };
  const sport = async (name: string) => prisma.sport.findUniqueOrThrow({ where: { name } });

  const ad = await user("ad@olsm.edu");
  const boysCoach = await user("bball.head@olsm.edu");
  const girlsCoach = await user("gbball.head@olsm.edu");
  const footballCoach = await user("football.head@olsm.edu");
  const trainer = await user("trainer@olsm.edu");
  const actor = (u: typeof ad) => ({ id: u.id, name: u.name, role: u.role });

  // Next Monday, so every generated booking is in the future no matter which
  // day this is run on. Bookings in the past are rejected, as they should be.
  const todayISO = instantToLocalDate(new Date());
  const dow = (new Date(`${todayISO}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftISODate(todayISO, 7 - dow);
  const day = (n: number) => shiftISODate(monday, n);

  const at = (dateISO: string, start: string, end: string) => ({
    startAt: localToInstant(dateISO, start),
    endAt: localToInstant(dateISO, end),
  });

  let created = 0;
  const make = async (input: Parameters<typeof createBooking>[0], who: typeof ad) => {
    try {
      const result = await createBooking(input, actor(who));
      created += 1;
      return result;
    } catch (error) {
      console.warn(`  skipped: ${(error as Error).message.slice(0, 90)}`);
      return null;
    }
  };

  // --- Standing team practices, Monday to Thursday ---------------------------
  for (const offset of [0, 1, 2, 3]) {
    await make(
      {
        requesterId: boysCoach.id,
        subSpaceId: (await space("rakoczy-gymnasium", "court-1")).id,
        activityType: "TEAM_PRACTICE",
        title: "Boys Basketball practice",
        sportId: (await sport("Boys Basketball")).id,
        teamLevel: "VARSITY",
        setupNotes: offset === 0 ? "Bleachers stay retracted." : null,
        ...at(day(offset), "15:30", "17:30"),
        overrideAvailability: true,
      },
      boysCoach,
    );

    await make(
      {
        requesterId: girlsCoach.id,
        subSpaceId: (await space("rakoczy-gymnasium", "court-2")).id,
        activityType: "TEAM_PRACTICE",
        title: "Girls Basketball practice",
        sportId: (await sport("Girls Basketball")).id,
        teamLevel: "VARSITY",
        ...at(day(offset), "15:30", "17:30"),
        overrideAvailability: true,
      },
      girlsCoach,
    );
  }

  // Strength sessions in the weight room, supervised.
  for (const offset of [0, 2]) {
    await make(
      {
        requesterId: trainer.id,
        subSpaceId: (await space("weight-room", "full-room")).id,
        activityType: "TEAM_PRACTICE",
        title: "Varsity lift",
        supervisorId: trainer.id,
        headcount: 24,
        ...at(day(offset), "07:00", "08:00"),
        overrideAvailability: true,
      },
      trainer,
    );
  }

  // --- A Friday contest ------------------------------------------------------
  await make(
    {
      requesterId: boysCoach.id,
      subSpaceId: (await space("rakoczy-gymnasium", "full-court")).id,
      activityType: "CONTEST",
      title: "Varsity vs. Detroit Catholic Central",
      sportId: (await sport("Boys Basketball")).id,
      teamLevel: "VARSITY",
      headcount: 900,
      setupNotes: "Full bleachers, scorer's table, national anthem mic.",
      equipmentNotes: "Two ball racks, visitor bench towels.",
      ...at(day(4), "19:00", "21:00"),
      overrideAvailability: true,
    },
    boysCoach,
  );

  // Football on the field Tuesday and Thursday.
  for (const offset of [1, 3]) {
    await make(
      {
        requesterId: footballCoach.id,
        subSpaceId: (await space("milewski-field", "full")).id,
        activityType: "TEAM_PRACTICE",
        title: "Football practice",
        sportId: (await sport("Football")).id,
        teamLevel: "VARSITY",
        ...at(day(offset), "15:45", "18:00"),
        overrideAvailability: true,
      },
      footballCoach,
    );
  }

  // --- A head coach's paid Saturday clinic: gated, awaiting paperwork --------
  const clinic = await make(
    {
      requesterId: boysCoach.id,
      subSpaceId: (await space("rakoczy-gymnasium", "full-court")).id,
      activityType: "PRIVATE_INSTRUCTION",
      title: "Saturday shooting clinic",
      headcount: 18,
      ...at(day(5), "09:00", "12:00"),
      overrideAvailability: true,
    },
    boysCoach,
  );

  if (clinic) {
    const step = await prisma.approvalStep.findFirst({ where: { bookingId: clinic.booking.id } });
    if (step) await decideApproval(step.id, "APPROVED", actor(ad), "Approved — collect the usual paperwork.");
    await ensureWaiverToken(clinic.booking.id, actor(boysCoach));
    await addRoster(
      clinic.booking.id,
      [
        { name: "Ava Nowak", email: "ava@example.com", isMinor: false },
        { name: "Marcus Bell", isMinor: true, guardianName: "Dana Bell", guardianEmail: "dana@example.com" },
        { name: "Liam Kowalski", isMinor: true, guardianName: "Piotr Kowalski", guardianEmail: "piotr@example.com" },
      ],
      actor(boysCoach),
    );
    // One of the three has signed, so the roster shows real progress.
    const first = await prisma.document.findFirst({
      where: { bookingId: clinic.booking.id, isParticipant: true, signerName: "Ava Nowak" },
    });
    if (first) {
      await prisma.document.update({
        where: { id: first.id },
        data: { status: "SIGNED", signedAt: new Date() },
      });
    }
  }

  // --- An outside club rental waiting in the approval queue -----------------
  const org = await prisma.organization.findFirstOrThrow({
    where: { name: "Michigan Elite Basketball Club" },
  });
  const clubContact = await prisma.user.upsert({
    where: { email: "coach@michiganelite.example" },
    update: {},
    create: {
      name: "Terry Vaughn",
      email: "coach@michiganelite.example",
      role: "EXTERNAL",
      phone: "+1 248 555 0142",
      smsOptIn: true,
      organizationId: org.id,
      emailVerifiedAt: new Date(),
    },
  });

  await make(
    {
      requesterId: clubContact.id,
      subSpaceId: (await space("dombrowski-fieldhouse", "full-floor")).id,
      activityType: "CLUB_TRAVEL",
      title: "U15 travel team practice",
      headcount: 30,
      ...at(day(6), "13:00", "16:00"),
      overrideAvailability: true,
    },
    clubContact,
  );

  // --- A school camp next week, collecting waivers ---------------------------
  await make(
    {
      requesterId: ad.id,
      subSpaceId: (await space("dombrowski-fieldhouse", "turf")).id,
      activityType: "SCHOOL_CAMP",
      title: "Youth skills camp",
      headcount: 40,
      setupNotes: "Six cones per station, water table at the north end.",
      ...at(day(8), "09:00", "15:00"),
      overrideAvailability: true,
    },
    ad,
  );

  // --- A maintenance blackout so the ops surfaces have something ------------
  const track = await prisma.facility.findUniqueOrThrow({ where: { slug: "running-track" } });
  const existingBlackout = await prisma.blackout.findFirst({ where: { facilityId: track.id } });
  if (!existingBlackout) {
    await prisma.blackout.create({
      data: {
        facilityId: track.id,
        ...at(day(2), "06:00", "22:00"),
        reason: "Resurfacing lanes 1–4",
        createdById: ad.id,
      },
    });
  }

  console.log(`demo data: ${created} bookings created for the week of ${monday}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
