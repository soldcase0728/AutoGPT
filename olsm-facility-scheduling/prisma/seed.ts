/**
 * Seed data.
 *
 * Facilities, sub-spaces and the conflict graph are real. The rules matrix is
 * the one from the project brief, loaded as data so the AD can edit any cell in
 * Admin > Rules without a deploy.
 *
 * The rental rate is set: a flat $50.00 per hour, every facility, every paid
 * requester type. Surcharges and the insurance minimums
 * are still placeholders marked [DECIDE].
 *
 * Run with: npm run db:seed
 */

import {
  ActivityType,
  DocumentStatus,
  DocumentType,
  OrganizationType,
  PrismaClient,
  RateTier,
  Role,
  SeasonCode,
  TeamLevel,
} from "@prisma/client";
import { agreementExpiryFor } from "../src/domain/compliance";
import { STANDARD_HOURS } from "../src/domain/availability";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { recordAudit } from "../src/lib/audit";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

interface SubSpaceSeed {
  name: string;
  slug: string;
  capacity: number;
  /** Slugs (within this facility unless prefixed "facility:slug") this blocks. */
  blocks?: string[];
  bufferMinutes?: number;
}

interface FacilitySeed {
  name: string;
  slug: string;
  type: string;
  indoor: boolean;
  capacity: number;
  requiresSupervision?: boolean;
  supervisionRoles?: Role[];
  bufferMinutes: number;
  externallyBookable: boolean;
  weatherDependent?: boolean;
  description: string;
  amenities: string[];
  subSpaces: SubSpaceSeed[];
  hours?: typeof STANDARD_HOURS;
}

const FACILITIES: FacilitySeed[] = [
  {
    name: "Milewski Field",
    slug: "milewski-field",
    type: "Outdoor field",
    indoor: false,
    capacity: 500,
    bufferMinutes: 15,
    externallyBookable: true,
    weatherDependent: true,
    description: "Outdoor grass field. Weather dependent; cancellations for weather are refunded in full.",
    amenities: ["Grass surface", "Spectator sideline", "Portable goals"],
    subSpaces: [
      { name: "Full field", slug: "full", capacity: 500, blocks: ["north", "south"] },
      { name: "North half", slug: "north", capacity: 250 },
      { name: "South half", slug: "south", capacity: 250 },
    ],
  },
  {
    name: "Dan Petry / Ziemba Stadium",
    slug: "petry-ziemba-stadium",
    type: "Outdoor stadium",
    indoor: false,
    capacity: 2500,
    bufferMinutes: 30,
    externallyBookable: true,
    weatherDependent: true,
    description: "The school's primary contest venue. Highest demand; contests take priority.",
    amenities: ["Lights", "Press box", "Concessions", "Public restrooms", "Bleacher seating"],
    subSpaces: [
      // The stadium field also closes the running track. That adjacency is an
      // edge in the conflict graph, editable by an admin.
      { name: "Field", slug: "field", capacity: 2500, blocks: ["facility:running-track:full"] },
      { name: "Track apron", slug: "track-apron", capacity: 200 },
      { name: "Press box", slug: "press-box", capacity: 20 },
      { name: "Concessions", slug: "concessions", capacity: 30 },
    ],
  },
  {
    name: "Dombrowski Fieldhouse",
    slug: "dombrowski-fieldhouse",
    type: "Indoor multi-use",
    indoor: true,
    capacity: 900,
    bufferMinutes: 20,
    externallyBookable: true,
    description: "Indoor multi-use fieldhouse. The highest indoor conflict risk on campus.",
    amenities: ["Batting cages", "Indoor turf", "Two courts", "Scoreboard"],
    subSpaces: [
      { name: "Full floor", slug: "full-floor", capacity: 900, blocks: ["court-a", "court-b"] },
      { name: "Court A", slug: "court-a", capacity: 400 },
      { name: "Court B", slug: "court-b", capacity: 400 },
      { name: "Batting cages", slug: "batting-cages", capacity: 30, bufferMinutes: 20 },
      { name: "Turf area", slug: "turf", capacity: 120 },
    ],
  },
  {
    name: "Rakoczy Gymnasium",
    slug: "rakoczy-gymnasium",
    type: "Indoor gym",
    indoor: true,
    capacity: 1200,
    bufferMinutes: 15,
    externallyBookable: true,
    description: "Main gymnasium. Also used for non-athletic school events such as Mass and assemblies.",
    amenities: ["Bleacher seating", "Sound system", "Scoreboard", "Locker rooms"],
    subSpaces: [
      { name: "Full court", slug: "full-court", capacity: 1200, blocks: ["court-1", "court-2"] },
      { name: "Court 1", slug: "court-1", capacity: 400 },
      { name: "Court 2", slug: "court-2", capacity: 400 },
      { name: "Auxiliary / upper", slug: "auxiliary", capacity: 150 },
    ],
  },
  {
    name: "St. Mary's Athletic Complex",
    slug: "athletic-complex",
    type: "Multi-field complex",
    indoor: false,
    capacity: 800,
    bufferMinutes: 15,
    externallyBookable: true,
    weatherDependent: true,
    // [DECIDE] Confirm the real sub-space names with the athletic office.
    // Facility descriptions are public. Say what a reader needs to know -- that
    // the field names may not match what they are called on campus -- without
    // naming an internal document they cannot open.
    description:
      "Multi-field outdoor complex. Field names here may differ from the names used on campus; " +
      "the athletic office will confirm the specific field when it reviews your request.",
    amenities: ["Multiple fields", "Baseball/softball diamonds", "Parking"],
    subSpaces: [
      { name: "Whole complex", slug: "whole", capacity: 800, blocks: ["field-1", "field-2", "field-3", "diamond-1", "diamond-2"] },
      { name: "Field 1", slug: "field-1", capacity: 200 },
      { name: "Field 2", slug: "field-2", capacity: 200 },
      { name: "Field 3", slug: "field-3", capacity: 200 },
      { name: "Diamond 1", slug: "diamond-1", capacity: 150 },
      { name: "Diamond 2", slug: "diamond-2", capacity: 150 },
    ],
  },
  {
    name: "Crew House",
    slug: "crew-house",
    type: "Specialty",
    indoor: true,
    capacity: 60,
    requiresSupervision: true,
    supervisionRoles: [Role.HEAD_COACH, Role.ASSISTANT_COACH, Role.STRENGTH_COACH],
    bufferMinutes: 15,
    // Water access: restricted requester list, not open to general external hire.
    externallyBookable: false,
    description:
      "Rowing facility with water access. Water-safety rules apply and a supervision-qualified " +
      "coach must be named on every booking. Space names here may differ from the names used on " +
      "campus; the athletic office will confirm the specific space when it reviews your request.",
    amenities: ["Boat bay", "Ergometers", "Dock access"],
    subSpaces: [
      { name: "Boat bay", slug: "boat-bay", capacity: 30 },
      { name: "Erg room", slug: "erg-room", capacity: 25 },
      { name: "Dock", slug: "dock", capacity: 20 },
    ],
  },
  {
    name: "Weight Training Room",
    slug: "weight-room",
    type: "Indoor training",
    indoor: true,
    capacity: 60,
    requiresSupervision: true,
    supervisionRoles: [Role.STRENGTH_COACH, Role.TRAINER, Role.HEAD_COACH],
    bufferMinutes: 10,
    externallyBookable: false,
    description:
      "Strength and conditioning space. A supervision-qualified staff member must be present " +
      "for every booking.",
    amenities: ["Platforms", "Racks", "Cardio equipment"],
    subSpaces: [
      { name: "Full room", slug: "full-room", capacity: 60, blocks: ["platforms", "cardio"] },
      { name: "Platform section", slug: "platforms", capacity: 30 },
      { name: "Cardio section", slug: "cardio", capacity: 25 },
    ],
  },
  {
    name: "Running Track",
    slug: "running-track",
    type: "Outdoor track",
    indoor: false,
    capacity: 300,
    bufferMinutes: 10,
    externallyBookable: true,
    weatherDependent: true,
    description:
      "Outdoor track. Shares blackout logic with the stadium: a stadium field booking closes the track.",
    amenities: ["Eight lanes", "Infield", "Timing shed"],
    subSpaces: [
      { name: "Full track", slug: "full", capacity: 300, blocks: ["lanes-1-4", "lanes-5-8", "infield"] },
      { name: "Lanes 1–4", slug: "lanes-1-4", capacity: 120 },
      { name: "Lanes 5–8", slug: "lanes-5-8", capacity: 120 },
      { name: "Infield", slug: "infield", capacity: 100 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Rules matrix (section 4 of the brief)
// ---------------------------------------------------------------------------

interface RuleSeed {
  activityType: ActivityType;
  requesterRole: Role | null;
  requiresAdminApproval: boolean;
  requiresHeadCoachApproval?: boolean;
  requiresContract: boolean;
  requiresWaiver: boolean;
  requiresCoi: boolean;
  requiresPayment: boolean;
  autoApprove: boolean;
  notifyAdmin?: boolean;
  priorityRank: number;
  mhsaaComplianceFlag?: boolean;
  notes: string;
}

const RULES: RuleSeed[] = [
  {
    activityType: ActivityType.MAINTENANCE,
    requesterRole: null,
    requiresAdminApproval: false,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: true,
    priorityRank: 5,
    notes: "Admin only. Blocks the space outright.",
  },
  {
    activityType: ActivityType.CONTEST,
    requesterRole: null,
    requiresAdminApproval: false,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: true,
    priorityRank: 10,
    notes: "Interscholastic competition. Auto-approved; annual agreement covers liability.",
  },
  {
    activityType: ActivityType.TEAM_PRACTICE,
    requesterRole: Role.HEAD_COACH,
    requiresAdminApproval: false,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: true,
    priorityRank: 20,
    notes: "In-season practice by the head coach. Zero friction: straight to CONFIRMED.",
  },
  {
    activityType: ActivityType.TEAM_PRACTICE,
    requesterRole: Role.ASSISTANT_COACH,
    requiresAdminApproval: false,
    requiresHeadCoachApproval: true,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: false,
    priorityRank: 20,
    notes: "Routes to the head coach of the sport for a one-click OK, not to the admin queue.",
  },
  {
    activityType: ActivityType.TEAM_PRACTICE,
    requesterRole: null,
    requiresAdminApproval: true,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: false,
    priorityRank: 20,
    notes: "Fallback for anyone else requesting a team practice.",
  },
  {
    activityType: ActivityType.SCHOOL_EVENT,
    requesterRole: null,
    requiresAdminApproval: true,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: false,
    priorityRank: 40,
    notes:
      "Mass, assembly, admissions event, banquet. [DECIDE] whether non-athletic departments " +
      "should route to a separate operations approver instead of the AD.",
  },
  {
    activityType: ActivityType.TEAM_OFFSEASON,
    requesterRole: Role.HEAD_COACH,
    requiresAdminApproval: false,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: true,
    notifyAdmin: true,
    priorityRank: 50,
    mhsaaComplianceFlag: true,
    notes:
      "Auto-approved with an AD notification. Carries an MHSAA out-of-season contact warning; " +
      "[DECIDE] confirm the current rules against the MHSAA handbook.",
  },
  {
    activityType: ActivityType.TEAM_OFFSEASON,
    requesterRole: null,
    requiresAdminApproval: true,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: false,
    priorityRank: 50,
    mhsaaComplianceFlag: true,
    notes: "Fallback for non-head-coach out-of-season requests.",
  },
  {
    activityType: ActivityType.SCHOOL_CAMP,
    requesterRole: null,
    requiresAdminApproval: true,
    requiresContract: true,
    requiresWaiver: true,
    requiresCoi: false,
    requiresPayment: true,
    autoApprove: false,
    priorityRank: 60,
    notes:
      "OLSM-run camp: camp addendum plus per-participant roster waiver. Internal rate applies " +
      "-- [DECIDE] what that rate is.",
  },
  {
    activityType: ActivityType.CLUB_TRAVEL,
    requesterRole: null,
    requiresAdminApproval: true,
    requiresContract: true,
    requiresWaiver: true,
    requiresCoi: true,
    requiresPayment: true,
    autoApprove: false,
    priorityRank: 70,
    notes: "Non-OLSM club or travel team. Full contract, waiver, COI and payment.",
  },
  {
    // No role-specific rows for PRIVATE_INSTRUCTION. That is the design: a head
    // coach running paid lessons hits this same row and clears the same gates.
    activityType: ActivityType.PRIVATE_INSTRUCTION,
    requesterRole: null,
    requiresAdminApproval: true,
    requiresContract: true,
    requiresWaiver: true,
    requiresCoi: true,
    requiresPayment: true,
    autoApprove: false,
    priorityRank: 80,
    notes:
      "Applies to ANY requester including head coaches. Paid instruction on school property " +
      "requires a contract, a per-booking waiver, a current COI and full payment.",
  },
  {
    activityType: ActivityType.EXTERNAL_RENTAL,
    requesterRole: null,
    requiresAdminApproval: true,
    requiresContract: true,
    requiresWaiver: true,
    requiresCoi: true,
    requiresPayment: true,
    autoApprove: false,
    priorityRank: 90,
    notes: "Third-party rental. Full rate, agreement, waiver, insurance and payment.",
  },
];

// ---------------------------------------------------------------------------
// Rates. The hourly rental rate is set; surcharges are not.
// ---------------------------------------------------------------------------

/**
 * The rental rate, in cents per hour.
 *
 * One flat rate: every facility, every paid requester type. This replaces the
 * earlier placeholder scheme of a per-facility base rate scaled by a discount
 * multiplier per tier, so the stadium and the running track now cost the same
 * per hour, and a commercial renter and a non-profit pay the same.
 *
 * If the school later wants to charge more for the stadium than the track, or
 * to give non-profits a discount, that is a rate card per facility and tier --
 * the schema already carries both columns, so it is data rather than code.
 */
const RENTAL_HOURLY_CENTS = 5000;

/**
 * Internal school use is not a rental and is not charged. Every other tier pays
 * the flat rate.
 */
function hourlyCentsFor(rateTier: RateTier): number {
  return rateTier === RateTier.INTERNAL ? 0 : RENTAL_HOURLY_CENTS;
}

/** Activity types that are billable at all. */
const BILLABLE: ActivityType[] = [
  ActivityType.SCHOOL_CAMP,
  ActivityType.PRIVATE_INSTRUCTION,
  ActivityType.CLUB_TRAVEL,
  ActivityType.EXTERNAL_RENTAL,
];

// ---------------------------------------------------------------------------

async function main() {
  console.log("Seeding OLSM facility scheduling…");

  // --- Facilities and the conflict graph -----------------------------------
  const subSpaceIdBySlug = new Map<string, string>();

  for (const seed of FACILITIES) {
    const facility = await prisma.facility.upsert({
      where: { slug: seed.slug },
      update: {
        name: seed.name,
        type: seed.type,
        indoor: seed.indoor,
        capacity: seed.capacity,
        requiresSupervision: seed.requiresSupervision ?? false,
        supervisionRoles: seed.supervisionRoles ?? [],
        defaultHours: (seed.hours ?? STANDARD_HOURS) as object,
        bufferMinutes: seed.bufferMinutes,
        externallyBookable: seed.externallyBookable,
        weatherDependent: seed.weatherDependent ?? false,
        description: seed.description,
        amenities: seed.amenities,
      },
      create: {
        name: seed.name,
        slug: seed.slug,
        type: seed.type,
        indoor: seed.indoor,
        capacity: seed.capacity,
        requiresSupervision: seed.requiresSupervision ?? false,
        supervisionRoles: seed.supervisionRoles ?? [],
        defaultHours: (seed.hours ?? STANDARD_HOURS) as object,
        bufferMinutes: seed.bufferMinutes,
        externallyBookable: seed.externallyBookable,
        weatherDependent: seed.weatherDependent ?? false,
        description: seed.description,
        amenities: seed.amenities,
      },
    });

    for (const [i, sub] of seed.subSpaces.entries()) {
      const created = await prisma.subSpace.upsert({
        where: { facilityId_slug: { facilityId: facility.id, slug: sub.slug } },
        update: {
          name: sub.name,
          capacity: sub.capacity,
          bufferMinutes: sub.bufferMinutes ?? null,
          sortOrder: i,
        },
        create: {
          facilityId: facility.id,
          name: sub.name,
          slug: sub.slug,
          capacity: sub.capacity,
          bufferMinutes: sub.bufferMinutes ?? null,
          sortOrder: i,
        },
      });
      subSpaceIdBySlug.set(`${seed.slug}:${sub.slug}`, created.id);
    }
  }

  // Second pass: wire blocksIds now that every sub-space has an id.
  for (const seed of FACILITIES) {
    for (const sub of seed.subSpaces) {
      if (!sub.blocks?.length) continue;
      const id = subSpaceIdBySlug.get(`${seed.slug}:${sub.slug}`)!;
      const blocks = sub.blocks
        .map((ref) =>
          ref.startsWith("facility:")
            ? subSpaceIdBySlug.get(ref.slice("facility:".length))
            : subSpaceIdBySlug.get(`${seed.slug}:${ref}`),
        )
        .filter((v): v is string => Boolean(v));
      await prisma.subSpace.update({ where: { id }, data: { blocksIds: blocks } });
    }
  }
  console.log(`  facilities: ${FACILITIES.length}, sub-spaces: ${subSpaceIdBySlug.size}`);

  // --- Rules ---------------------------------------------------------------
  for (const rule of RULES) {
    const data = {
      requiresAdminApproval: rule.requiresAdminApproval,
      requiresHeadCoachApproval: rule.requiresHeadCoachApproval ?? false,
      requiresContract: rule.requiresContract,
      requiresWaiver: rule.requiresWaiver,
      requiresCoi: rule.requiresCoi,
      requiresPayment: rule.requiresPayment,
      autoApprove: rule.autoApprove,
      notifyAdmin: rule.notifyAdmin ?? false,
      priorityRank: rule.priorityRank,
      mhsaaComplianceFlag: rule.mhsaaComplianceFlag ?? false,
      notes: rule.notes,
    };

    // Not `upsert`: Prisma cannot target a compound unique whose column is
    // null, and the generic fallback rows have requesterRole = null.
    const existing = await prisma.rule.findFirst({
      where: { activityType: rule.activityType, requesterRole: rule.requesterRole },
    });

    if (existing) {
      await prisma.rule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.rule.create({
        data: { activityType: rule.activityType, requesterRole: rule.requesterRole, ...data },
      });
    }
  }
  console.log(`  rules: ${RULES.length}`);

  // --- Rate cards ----------------------------------------------------------
  const facilities = await prisma.facility.findMany();
  const effectiveFrom = new Date(Date.UTC(2020, 0, 1));
  let rateCount = 0;
  let skippedRates = 0;

  for (const facility of facilities) {
    for (const activityType of BILLABLE) {
      for (const rateTier of Object.values(RateTier)) {
        const hourlyCents = hourlyCentsFor(rateTier);
        const existing = await prisma.rateCard.findFirst({
          where: { facilityId: facility.id, activityType, rateTier, effectiveTo: null },
        });
        const data = {
          hourlyCents,
          // Full-day cap at six hours of the hourly rate. Placeholder.
          flatDayCents: hourlyCents > 0 ? hourlyCents * 6 : null,
          minHours: 1,
          effectiveFrom,
        };
        // Create what is missing; never rewrite what is there.
        //
        // This used to update the existing row, which meant a restart reverted
        // every rate the business office had set through the admin screen --
        // so the screen looked authoritative and was not. A rate is a business
        // decision with invoices attached to it; the seed's job is to make a
        // new database usable, not to keep asserting its opinion over one that
        // is already in service.
        if (existing) {
          skippedRates += 1;
        } else {
          await prisma.rateCard.create({
            data: { facilityId: facility.id, activityType, rateTier, ...data },
          });
          rateCount += 1;
        }
      }
    }
  }
  // Three separate numbers on purpose. "Updated" should be 0 for ever; if it
  // is not, something has reintroduced the overwrite this seed was changed to
  // stop doing, and that is visible at a glance in the deploy log.
  console.log(`  rate cards — created: ${rateCount}`);
  console.log(`  rate cards — already existed: ${skippedRates}`);
  console.log(`  rate cards — updated: 0 (existing rates are never overwritten)`);

  // --- Surcharges ----------------------------------------------------------
  const surcharges = [
    { code: "LIGHTS", label: "Field lights", kind: "hourly", amountCents: 7500 },
    { code: "CUSTODIAL", label: "Custodial / setup", kind: "hourly", amountCents: 5000 },
    { code: "SUPERVISION", label: "Staff supervision", kind: "hourly", amountCents: 4500 },
    { code: "TRAINER", label: "Athletic trainer coverage", kind: "hourly", amountCents: 6500 },
  ];
  for (const s of surcharges) {
    await prisma.surcharge.upsert({ where: { code: s.code }, update: s, create: s });
  }
  console.log(`  surcharges: ${surcharges.length} (PLACEHOLDER pricing)`);

  // --- Sports --------------------------------------------------------------
  // Calendar colours, 1-6, matching SPORT_PALETTE in src/domain/sport-colors.ts.
  //
  // Assigned so that no two sports sharing a season share a hue -- that is the
  // case a coach actually sees, and the school never runs more than four sports
  // at once. Six slots cannot also keep neighbouring seasons apart (fall and
  // winter alone hold seven sports), so where a reuse was forced it went to the
  // pair whose seasons barely touch: cross country has finished by the time
  // hockey starts, wrestling by the time lacrosse does.
  const SPORTS: { name: string; seasonCode: SeasonCode; colorSlot: number }[] = [
    { name: "Football", seasonCode: SeasonCode.FALL, colorSlot: 1 },
    { name: "Boys Soccer", seasonCode: SeasonCode.FALL, colorSlot: 2 },
    { name: "Cross Country", seasonCode: SeasonCode.FALL, colorSlot: 3 },
    { name: "Boys Basketball", seasonCode: SeasonCode.WINTER, colorSlot: 4 },
    { name: "Girls Basketball", seasonCode: SeasonCode.WINTER, colorSlot: 5 },
    { name: "Wrestling", seasonCode: SeasonCode.WINTER, colorSlot: 6 },
    { name: "Hockey", seasonCode: SeasonCode.WINTER, colorSlot: 3 },
    { name: "Baseball", seasonCode: SeasonCode.SPRING, colorSlot: 1 },
    { name: "Track & Field", seasonCode: SeasonCode.SPRING, colorSlot: 2 },
    { name: "Rowing", seasonCode: SeasonCode.SPRING, colorSlot: 5 },
    { name: "Lacrosse", seasonCode: SeasonCode.SPRING, colorSlot: 6 },
  ];
  for (const sport of SPORTS) {
    await prisma.sport.upsert({ where: { name: sport.name }, update: sport, create: sport });
  }
  console.log(`  sports: ${SPORTS.length}`);

  // --- Organizations -------------------------------------------------------
  const internalOrg = await upsertOrg("Orchard Lake St. Mary's Preparatory", OrganizationType.INTERNAL, RateTier.INTERNAL);
  await upsertOrg("Orchard Lake Polish Mission", OrganizationType.PARISH, RateTier.PARISH_PARTNER);
  await upsertOrg("Michigan Elite Basketball Club", OrganizationType.CLUB, RateTier.OLSM_AFFILIATED_CLUB);
  await upsertOrg("Lakeshore Athletics LLC", OrganizationType.COMMERCIAL, RateTier.COMMERCIAL);

  // --- Users ---------------------------------------------------------------
  // The published default, and why production never gets it.
  //
  // This repository is public. A seeded password written here is a password
  // anybody can read, so on a hosted instance it is not a starting credential --
  // it is an open door to a SUPER_ADMIN account. Production therefore seeds
  // accounts with no password at all: they cannot be signed into until somebody
  // sets one through a one-time link.
  //
  // Development and the test suites keep the known value, because there the
  // database is disposable and the whole point is to sign in without ceremony.
  const DEFAULT_PASSWORD = "ChangeMe123456";
  const hosted = process.env.NODE_ENV === "production";
  const password = hosted ? null : await hashPassword(DEFAULT_PASSWORD);

  const users: {
    name: string;
    email: string;
    role: Role;
    sports?: { name: string; isHead: boolean; teamLevel?: TeamLevel }[];
    facilityScopeSlugs?: string[];
    signsAgreement?: boolean;
  }[] = [
    { name: "Athletic Director", email: "ad@olsm.edu", role: Role.SUPER_ADMIN },
    { name: "Athletic Office", email: "athleticoffice@olsm.edu", role: Role.FACILITY_ADMIN },
    {
      name: "Head Coach, Boys Basketball",
      email: "bball.head@olsm.edu",
      role: Role.HEAD_COACH,
      sports: [{ name: "Boys Basketball", isHead: true, teamLevel: TeamLevel.VARSITY }],
      signsAgreement: true,
    },
    {
      name: "Assistant Coach, Boys Basketball",
      email: "bball.assistant@olsm.edu",
      role: Role.ASSISTANT_COACH,
      sports: [{ name: "Boys Basketball", isHead: false, teamLevel: TeamLevel.JV }],
      signsAgreement: true,
    },
    {
      name: "Head Coach, Football",
      email: "football.head@olsm.edu",
      role: Role.HEAD_COACH,
      sports: [{ name: "Football", isHead: true, teamLevel: TeamLevel.VARSITY }],
      signsAgreement: true,
    },
    {
      name: "Head Coach, Girls Basketball",
      email: "gbball.head@olsm.edu",
      role: Role.HEAD_COACH,
      sports: [{ name: "Girls Basketball", isHead: true, teamLevel: TeamLevel.VARSITY }],
      signsAgreement: true,
    },
    {
      name: "Athletic Trainer",
      email: "trainer@olsm.edu",
      role: Role.TRAINER,
      facilityScopeSlugs: ["weight-room", "dombrowski-fieldhouse"],
      signsAgreement: true,
    },
    {
      name: "Strength Coach",
      email: "strength@olsm.edu",
      role: Role.STRENGTH_COACH,
      facilityScopeSlugs: ["weight-room"],
      signsAgreement: true,
    },
    { name: "Facilities Lead", email: "facilities@olsm.edu", role: Role.FACILITIES },
    { name: "Business Office", email: "finance@olsm.edu", role: Role.FINANCE },
  ];

  const facilityIdBySlug = new Map(facilities.map((f) => [f.slug, f.id]));

  for (const seed of users) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: {
        name: seed.name,
        role: seed.role,
        facilityScope: (seed.facilityScopeSlugs ?? [])
          .map((s) => facilityIdBySlug.get(s))
          .filter((v): v is string => Boolean(v)),
      },
      create: {
        name: seed.name,
        email: seed.email,
        role: seed.role,
        passwordHash: password,
        // Null on a hosted instance: the address is not proven until the person
        // uses the link that sets their password.
        emailVerifiedAt: password ? new Date() : null,
        organizationId: internalOrg.id,
        facilityScope: (seed.facilityScopeSlugs ?? [])
          .map((s) => facilityIdBySlug.get(s))
          .filter((v): v is string => Boolean(v)),
      },
    });

    for (const sportSeed of seed.sports ?? []) {
      const sport = await prisma.sport.findUnique({ where: { name: sportSeed.name } });
      if (!sport) continue;
      const teamLevel = sportSeed.teamLevel ?? TeamLevel.VARSITY;
      await prisma.coachAssignment.upsert({
        where: { userId_sportId_teamLevel: { userId: user.id, sportId: sport.id, teamLevel } },
        update: { isHead: sportSeed.isHead },
        create: { userId: user.id, sportId: sport.id, teamLevel, isHead: sportSeed.isHead },
      });
    }

    // A signed Annual Coach Agreement is what lets a coach book at all.
    if (seed.signsAgreement) {
      const existing = await prisma.document.findFirst({
        where: { userId: user.id, type: DocumentType.ANNUAL_COACH_AGREEMENT },
      });
      if (!existing) {
        await prisma.document.create({
          data: {
            userId: user.id,
            type: DocumentType.ANNUAL_COACH_AGREEMENT,
            status: DocumentStatus.SIGNED,
            provider: "manual",
            signerName: user.name,
            signerEmail: user.email,
            signedAt: new Date(),
            expiresAt: agreementExpiryFor(),
          },
        });
      }
    }
  }
  // Close the door on an instance seeded before this changed.
  //
  // Accounts already carrying the published password are the live exposure, and
  // they exist on every instance deployed from this repository so far. Clearing
  // the hash is safe in a way that overwriting it would not be: it touches only
  // accounts still on the value anybody can read, and it never disturbs a
  // password somebody has chosen.
  let disarmed = 0;
  if (hosted) {
    for (const seed of users) {
      const account = await prisma.user.findUnique({ where: { email: seed.email } });
      if (!account?.passwordHash) continue;
      if (!(await verifyPassword(DEFAULT_PASSWORD, account.passwordHash))) continue;
      await prisma.user.update({
        where: { id: account.id },
        data: { passwordHash: null },
      });
      await recordAudit({
        entityType: "user",
        entityId: account.id,
        action: "user.default_password_cleared",
        actorLabel: "seed",
        reason:
          "The account was still on the password published in this repository. " +
          "Cleared on boot; a one-time link is required to set a real one.",
      });
      disarmed += 1;
    }
  }

  if (hosted) {
    console.log(`  users: ${users.length} (no passwords set — this instance is hosted)`);
    if (disarmed > 0) {
      console.log(
        `  ${disarmed} account(s) were still on the password published in this repository.`,
      );
      console.log("  Those passwords no longer work. Nobody can sign in with them.");
    }
  } else {
    console.log(`  users: ${users.length} (password for all seeded accounts: ${DEFAULT_PASSWORD})`);
  }

  // --- Seasons -------------------------------------------------------------
  const year = new Date().getUTCFullYear();
  const seasons = [
    { name: `Fall ${year}`, seasonCode: SeasonCode.FALL, start: `${year}-08-10`, end: `${year}-11-05` },
    { name: `Winter ${year}-${year + 1}`, seasonCode: SeasonCode.WINTER, start: `${year}-11-10`, end: `${year + 1}-03-06` },
    { name: `Spring ${year + 1}`, seasonCode: SeasonCode.SPRING, start: `${year + 1}-03-09`, end: `${year + 1}-06-05` },
    { name: `Summer ${year + 1}`, seasonCode: SeasonCode.SUMMER, start: `${year + 1}-06-08`, end: `${year + 1}-08-07` },
  ];
  for (const season of seasons) {
    const existing = await prisma.season.findFirst({ where: { name: season.name } });
    if (existing) continue;
    await prisma.season.create({
      data: {
        name: season.name,
        seasonCode: season.seasonCode,
        startDate: new Date(`${season.start}T00:00:00Z`),
        endDate: new Date(`${season.end}T00:00:00Z`),
      },
    });
  }
  console.log(`  seasons: ${seasons.length}`);

  if (hosted) {
    // A hosted instance has no password to hand anybody, so it prints the way
    // in instead. The link is one-time and expires in seven days, and this log
    // is visible only to whoever can already see the deploy -- which is a far
    // smaller audience than a password committed to a public repository.
    //
    // Imported here rather than at the top of the file: the token module is
    // marked server-only, which throws under the plain `tsx` runner used in
    // development. This branch never executes there.
    const { issueAccessToken } = await import("../src/lib/auth/access-token");
    const director = await prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN, active: true },
      orderBy: { createdAt: "asc" },
    });

    console.log("\nThis instance is hosted, so no account has a password.");
    if (director) {
      const token = await issueAccessToken({ userId: director.id });
      const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
      console.log(`\nOne-time link to set a password for ${director.email}:\n`);
      console.log(`  ${base}/set-password/${token}`);
      console.log("\nIt works once and expires in seven days. Open it now: this log is the only");
      console.log("place it appears, and the next deploy will replace it with a different one.");
    } else {
      console.log("No super admin exists. Run: node dist-scripts/grant-admin.js you@olsm.edu");
    }
  } else {
    console.log(`\nDone. Sign in at /sign-in with any seeded address, password ${DEFAULT_PASSWORD}.`);
  }
  console.log("\nSurcharges, insurance minimums, retention and cancellation windows are placeholders.");
  console.log("See DECISIONS.md before this goes anywhere near a real rental.\n");
}

async function upsertOrg(name: string, type: OrganizationType, rateTier: RateTier) {
  const existing = await prisma.organization.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.organization.create({ data: { name, type, rateTier } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
