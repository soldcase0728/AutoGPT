/**
 * Integration-test database helpers.
 *
 * The schema is migrated once per run; each test file resets the transactional
 * tables (bookings, invoices, documents, audit) but keeps the seeded reference
 * data (facilities, rules, rates), which is what the tests are asserting
 * against.
 */

import { execSync } from "node:child_process";
import { PrismaClient, Role } from "@prisma/client";
import { localToInstant } from "@/lib/time";

let migrated = false;

export function ensureMigrated(): void {
  if (migrated) return;
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
  execSync("npx tsx prisma/seed.ts", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
  migrated = true;
}

export const db = new PrismaClient();

/**
 * Wipe everything a test could have created, leaving seeded reference data.
 * audit_log is append-only, so it is dropped with a privileged TRUNCATE that
 * temporarily disables the guard trigger -- see the comment below.
 */
export async function resetTransactionalData(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE booking_occupancy, booking_requirements, approval_steps, invoices,
             documents, waitlist_entries, blackouts, standing_blocks, job_queue,
             bookings
    RESTART IDENTITY CASCADE
  `);

  // The append-only guard is exactly what we are testing elsewhere, so removing
  // it here is done explicitly and only in the test database.
  await db.$executeRawUnsafe(`ALTER TABLE audit_log DISABLE TRIGGER USER`);
  await db.$executeRawUnsafe(`TRUNCATE audit_log`);
  await db.$executeRawUnsafe(`ALTER TABLE audit_log ENABLE TRIGGER USER`);

  // Documents attached to users (annual agreements) are re-seeded by
  // reseedAgreements() when a test needs them.
}

/** Re-create the seeded signed Annual Coach Agreements after a reset. */
export async function reseedAgreements(): Promise<void> {
  const { agreementExpiryFor } = await import("@/domain/compliance");
  const coaches = await db.user.findMany({
    where: {
      role: { in: [Role.HEAD_COACH, Role.ASSISTANT_COACH, Role.TRAINER, Role.STRENGTH_COACH] },
    },
  });

  for (const coach of coaches) {
    const existing = await db.document.findFirst({
      where: { userId: coach.id, type: "ANNUAL_COACH_AGREEMENT" },
    });
    if (existing) continue;
    await db.document.create({
      data: {
        userId: coach.id,
        type: "ANNUAL_COACH_AGREEMENT",
        status: "SIGNED",
        provider: "manual",
        signerName: coach.name,
        signerEmail: coach.email,
        signedAt: new Date(),
        expiresAt: agreementExpiryFor(),
      },
    });
  }
}

export async function userByEmail(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Seeded user ${email} is missing. Did the seed run?`);
  return user;
}

export async function subSpace(facilitySlug: string, subSpaceSlug: string) {
  const facility = await db.facility.findUnique({ where: { slug: facilitySlug } });
  if (!facility) throw new Error(`Seeded facility ${facilitySlug} is missing.`);
  const sub = await db.subSpace.findUnique({
    where: { facilityId_slug: { facilityId: facility.id, slug: subSpaceSlug } },
  });
  if (!sub) throw new Error(`Seeded sub-space ${facilitySlug}/${subSpaceSlug} is missing.`);
  return sub;
}

export function actorFor(user: { id: string; name: string; role: Role }) {
  return { id: user.id, name: user.name, role: user.role };
}

/**
 * A future Tuesday at a given local wall-clock time. Always a weekday inside
 * published Mon-Fri hours, so a test never fails because "now + 7 days" landed
 * on a Sunday, and always converted through the real timezone helper so DST is
 * handled the same way production handles it.
 *
 * `slot` is a distinct integer per test case; each slot gets its own hour, so
 * two tests in the same file cannot collide on the exclusion constraint.
 */
export function futureSlot(
  slot: number,
  durationMinutes = 60,
  weeksAhead = 2,
): { startAt: Date; endAt: Date; dateISO: string } {
  const base = new Date(Date.now() + weeksAhead * 7 * 86_400_000);
  while (base.getUTCDay() !== 2) base.setUTCDate(base.getUTCDate() + 1);
  const dateISO = base.toISOString().slice(0, 10);

  // Slots walk 08:00, 09:00 ... inside the seeded 06:00-22:00 window.
  const hour = 8 + (slot % 12);
  const startAt = localToInstant(dateISO, `${String(hour).padStart(2, "0")}:00`);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return { startAt, endAt, dateISO };
}
