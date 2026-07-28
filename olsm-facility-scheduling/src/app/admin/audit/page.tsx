import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Card, EmptyState, PageHeader, Table, TableWrap, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 100;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string; entityType?: string; action?: string; page?: string }>;
}) {
  const user = await requirePermission("audit:view");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));

  const where = {
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.action ? { action: { contains: params.action } } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const exportHref = `/api/admin/audit-export?${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  )}`;

  return (
    <AppShell user={user}>
      <PageHeader
        title="Audit log"
        description="Every state change, approval, refund and override. Append-only — no role, including this one, can edit or delete an entry."
        action={
          <Link
            href={exportHref}
            className="rounded-md border border-navy-300 bg-white px-3.5 py-2 text-sm font-medium text-navy-800 hover:bg-navy-50"
          >
            Export CSV
          </Link>
        }
      />

      <div className="mb-5">
        <Alert tone="info">
          The append-only guarantee is enforced by database triggers, not by application code. An
          attempt to update or delete a row raises an error at the database level.
        </Alert>
      </div>

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Entity type</span>
            <select
              name="entityType"
              defaultValue={params.entityType ?? ""}
              className="rounded-md border border-navy-300 px-3 py-2 text-sm"
            >
              <option value="">All</option>
              {["booking", "invoice", "document", "facility", "rule", "user", "season", "blackout", "standing_block"].map(
                (t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Action contains</span>
            <input
              name="action"
              defaultValue={params.action ?? ""}
              placeholder="refund"
              className="rounded-md border border-navy-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Entity ID</span>
            <input
              name="entityId"
              defaultValue={params.entityId ?? ""}
              className="w-72 rounded-md border border-navy-300 px-3 py-2 font-mono text-xs"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Filter
          </button>
        </form>
      </Card>

      <Card
        title={`${total.toLocaleString()} entries`}
        description={`Showing ${entries.length}, newest first.`}
      >
        {entries.length === 0 ? (
          <EmptyState title="No entries match those filters" />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Actor</Th>
                  <Th>Change</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-xs text-navy-600">
                      {formatDateTime(entry.createdAt)}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-xs">{entry.action}</Td>
                    <Td className="text-xs">
                      {entry.entityType}
                      <Link
                        href={`/admin/audit?entityId=${entry.entityId}`}
                        className="block font-mono text-[10px] text-navy-500 hover:underline"
                      >
                        {entry.entityId.slice(0, 8)}…
                      </Link>
                    </Td>
                    <Td className="text-xs">
                      {entry.actorLabel ?? "—"}
                      {entry.ipAddress && (
                        <span className="block font-mono text-[10px] text-navy-500">
                          {entry.ipAddress}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {entry.fromState || entry.toState
                        ? `${entry.fromState ?? "—"} → ${entry.toState ?? "—"}`
                        : "—"}
                    </Td>
                    <Td className="max-w-sm text-xs text-navy-700">{entry.reason ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}

        {total > PAGE_SIZE && (
          <nav className="mt-4 flex gap-2 text-sm" aria-label="Pagination">
            {page > 1 && (
              <Link
                href={`?${new URLSearchParams({ ...params, page: String(page - 1) } as Record<string, string>)}`}
                className="rounded border border-navy-300 px-3 py-1.5 hover:bg-navy-50"
              >
                Previous
              </Link>
            )}
            {page * PAGE_SIZE < total && (
              <Link
                href={`?${new URLSearchParams({ ...params, page: String(page + 1) } as Record<string, string>)}`}
                className="rounded border border-navy-300 px-3 py-1.5 hover:bg-navy-50"
              >
                Next
              </Link>
            )}
          </nav>
        )}
      </Card>
    </AppShell>
  );
}
