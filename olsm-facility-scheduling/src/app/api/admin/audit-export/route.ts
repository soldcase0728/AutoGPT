import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/rbac";

const MAX_ROWS = 50_000;

/** CSV export of the audit log. Read-only; the log itself stays append-only. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "audit:view")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const q = request.nextUrl.searchParams;
  const entries = await prisma.auditLog.findMany({
    where: {
      ...(q.get("entityId") ? { entityId: q.get("entityId")! } : {}),
      ...(q.get("entityType") ? { entityType: q.get("entityType")! } : {}),
      ...(q.get("action") ? { action: { contains: q.get("action")! } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });

  const header = [
    "created_at",
    "entity_type",
    "entity_id",
    "action",
    "actor_id",
    "actor",
    "from_state",
    "to_state",
    "reason",
    "ip_address",
    "payload",
  ];

  const rows = entries.map((e) => [
    e.createdAt.toISOString(),
    e.entityType,
    e.entityId,
    e.action,
    e.actorId ?? "",
    e.actorLabel ?? "",
    e.fromState ?? "",
    e.toState ?? "",
    e.reason ?? "",
    e.ipAddress ?? "",
    e.payload ? JSON.stringify(e.payload) : "",
  ]);

  const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="olsm-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

/**
 * Quote every field and neutralise formula injection: a reason field beginning
 * with "=" would otherwise execute when the export is opened in Excel.
 */
function escapeCsv(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
