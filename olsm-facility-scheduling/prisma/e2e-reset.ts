/**
 * Reset the end-to-end database to a known state.
 *
 * Without this the suite only passes on a freshly created database: bookings
 * from a previous run keep holding their slots, and the second run fails on the
 * exclusion constraint. An e2e suite that cannot be run twice is not much of a
 * safety net.
 *
 * Reference data (facilities, rules, rate cards, staff) is left alone and
 * re-upserted by the seed; only what a test could have created is removed.
 */

import { PrismaClient } from "@prisma/client";
import { databaseNameFromUrl, isDisposableDatabase } from "../src/lib/env";

const prisma = new PrismaClient();

const DATABASE = databaseNameFromUrl(process.env.DATABASE_URL ?? "");

async function main() {
  // Same guard as the fixture endpoints, and now literally the same function:
  // never truncate a database that is not obviously disposable.
  if (!isDisposableDatabase(process.env.DATABASE_URL ?? "")) {
    throw new Error(
      `Refusing to reset "${DATABASE}". This script only runs against a database ` +
        `whose name ends in _e2e or _test.`,
    );
  }

  await prisma.$executeRawUnsafe(`
    TRUNCATE booking_occupancy, booking_requirements, approval_steps, invoices,
             documents, waitlist_entries, blackouts, standing_blocks, job_queue,
             sessions, bookings
    RESTART IDENTITY CASCADE
  `);

  // The audit log is append-only by trigger; disable the guard explicitly for
  // this one disposable database rather than working around it in app code.
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_log DISABLE TRIGGER USER`);
  await prisma.$executeRawUnsafe(`TRUNCATE audit_log`);
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_log ENABLE TRIGGER USER`);

  // Accounts a test created by submitting the public request form.
  const removed = await prisma.user.deleteMany({
    where: { role: "EXTERNAL", email: { not: { endsWith: "@olsm.edu" } } },
  });

  // Booking references come from a sequence; restart it so references stay
  // short and predictable across runs.
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE booking_reference_seq RESTART WITH 1`);

  console.log(`e2e reset: transactional tables cleared, ${removed.count} test account(s) removed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
