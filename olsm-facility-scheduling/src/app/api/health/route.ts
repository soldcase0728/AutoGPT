import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness in one endpoint.
 *
 * Checks the database, because an app that boots but cannot reach Postgres is
 * not ready to take a booking, and a load balancer that only pings the process
 * would happily send traffic to it. Returns 503 when the database is
 * unreachable so a deploy fails visibly rather than serving errors.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    // Reference data is loaded on boot; its absence means a half-finished
    // deploy, which is worth surfacing rather than discovering in the UI.
    const facilities = await prisma.facility.count();

    return NextResponse.json({
      status: facilities > 0 ? "ok" : "degraded",
      database: "reachable",
      facilities,
      latencyMs: Date.now() - startedAt,
      detail: facilities > 0 ? undefined : "No facilities loaded — the seed may not have run.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        database: "unreachable",
        detail: error instanceof Error ? error.message.slice(0, 200) : "Unknown error.",
      },
      { status: 503 },
    );
  }
}
