import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isDisposableDatabase } from "@/lib/env";
import { randomToken } from "@/lib/auth/password";

/**
 * Test fixtures for the end-to-end suite.
 *
 * These endpoints put the database into states the UI cannot reach quickly --
 * revoking a coach's annual agreement, minting a booking with a waiver link.
 * That makes them dangerous: one of them removes a compliance record.
 *
 * Three independent locks, all required:
 *
 *   1. E2E_FIXTURES must be exactly "1". Only scripts/e2e-server.mjs sets it.
 *   2. A constant-time match on E2E_TOKEN.
 *   3. The connected database must be named for testing (..._e2e or ..._test).
 *
 * The third lock is the one that matters. Checking NODE_ENV would be useless
 * here -- `next start` runs in production mode, so the e2e suite itself is a
 * production build -- and an env flag alone is one typo away from being set on
 * a real deployment. Refusing to run against a database that is not obviously
 * disposable means the worst case of that typo is a 404 rather than a deleted
 * compliance record.
 *
 * Any failure returns 404 rather than 401, so a probe cannot tell these routes
 * exist.
 */

function enabled(): boolean {
  if (process.env.E2E_FIXTURES !== "1") return false;

  // Never mutate anything but a disposable database.
  return isDisposableDatabase(process.env.DATABASE_URL ?? "");
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.E2E_TOKEN ?? "";
  if (!expected) return false;
  const provided = request.headers.get("x-e2e-token") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  if (!enabled() || !authorized(request)) return notFound();

  const { action } = await context.params;

  switch (action) {
    /** Remove a coach's annual agreement so the compliance block can be seen. */
    case "revoke-agreement": {
      const { email } = (await request.json()) as { email?: string };
      if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return NextResponse.json({ error: "unknown user" }, { status: 404 });

      await prisma.document.deleteMany({
        where: { userId: user.id, type: "ANNUAL_COACH_AGREEMENT" },
      });
      return NextResponse.json({ ok: true, userId: user.id });
    }

    /** A confirmed booking with a public participant-waiver link. */
    case "waiver-booking": {
      const coach = await prisma.user.findUniqueOrThrow({
        where: { email: "bball.head@olsm.edu" },
      });
      const subSpace = await prisma.subSpace.findFirstOrThrow({
        where: { slug: "batting-cages" },
      });

      const startAt = new Date(Date.now() + 5 * 86_400_000);
      const token = randomToken(24);
      const title = `E2E waiver clinic ${Date.now()}`;

      const booking = await prisma.booking.create({
        data: {
          reference: `E2E-${Date.now()}`,
          requesterId: coach.id,
          subSpaceId: subSpace.id,
          activityType: "PRIVATE_INSTRUCTION",
          title,
          startAt,
          endAt: new Date(startAt.getTime() + 2 * 3_600_000),
          headcount: 6,
          status: "CONFIRMED",
          priority: 80,
          waiverToken: token,
        },
      });

      return NextResponse.json({ ok: true, bookingId: booking.id, token, title });
    }

    default:
      return notFound();
  }
}
