import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import {
  Alert,
  Card,
  EmptyState,
  PageHeader,
  Stat,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { formatMoney } from "@/domain/pricing";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { instantToLocalDate, shiftISODate, startOfLocalDay } from "@/lib/time";
import {
  operationsSummary,
  revenueReport,
  timeOfDayHistogram,
  utilizationReport,
  type RevenueRow,
} from "@/services/reporting-service";
import { expiringCertificates, staffMissingAgreements } from "@/services/document-service";
import { COI_WARNING_DAYS } from "@/domain/compliance";
import type { ActivityType } from "@prisma/client";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePermission("report:view");
  const params = await searchParams;

  const todayISO = instantToLocalDate(new Date());
  const fromISO = params.from ?? shiftISODate(todayISO, -365);
  const toISO = params.to ?? shiftISODate(todayISO, 1);
  const range = { from: startOfLocalDay(fromISO), to: startOfLocalDay(toISO) };

  const [revenue, utilization, histogram, summary, expiring, missingAgreements] = await Promise.all([
    revenueReport(range),
    utilizationReport(range),
    timeOfDayHistogram(range),
    operationsSummary(),
    expiringCertificates(COI_WARNING_DAYS),
    staffMissingAgreements(),
  ]);

  const peakCount = Math.max(1, ...histogram.map((h) => h.count));

  return (
    <AppShell user={user}>
      <PageHeader
        title="Reports"
        description="Utilisation, revenue and compliance. Revenue captured from non-team use is the number this system exists to move."
      />

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">From</span>
            <input
              type="date"
              name="from"
              defaultValue={fromISO}
              className="rounded-md border border-navy-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">To</span>
            <input
              type="date"
              name="to"
              defaultValue={toISO}
              className="rounded-md border border-navy-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Update
          </button>
        </form>
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue from non-team use"
          value={formatMoney(revenue.nonTeamNetCents)}
          hint="Private instruction, club, camp and external rental — the primary success metric."
        />
        <Stat label="Total revenue" value={formatMoney(revenue.totalNetCents)} hint="Net of refunds." />
        <Stat label="Denied (30 days)" value={summary.deniedLast30} />
        <Stat label="No-shows (30 days)" value={summary.noShowLast30} />
      </div>

      <div className="space-y-5">
        <Card title="Revenue by facility">
          <RevenueTable rows={revenue.byFacility} emptyLabel="No paid bookings in this range." />
        </Card>

        <Card title="Revenue by activity type">
          <RevenueTable
            rows={revenue.byActivityType.map((r) => ({
              ...r,
              label: ACTIVITY_LABELS[r.label as ActivityType] ?? r.label,
            }))}
            emptyLabel="No paid bookings in this range."
          />
        </Card>

        <Card title="Revenue by organization">
          <RevenueTable rows={revenue.byOrganization} emptyLabel="No paid bookings in this range." />
        </Card>

        <Card title="Utilisation by facility" description="Booked hours against published open hours.">
          {utilization.length === 0 ? (
            <EmptyState title="No confirmed bookings in this range." />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Facility</Th>
                    <Th className="text-right">Bookings</Th>
                    <Th className="text-right">Booked hours</Th>
                    <Th className="text-right">Utilisation</Th>
                  </tr>
                </thead>
                <tbody>
                  {utilization.map((row) => (
                    <tr key={row.facilityId}>
                      <Td className="font-medium">{row.facilityName}</Td>
                      <Td className="text-right">{row.bookings}</Td>
                      <Td className="text-right font-mono">{Math.round(row.bookedHours)}</Td>
                      <Td className="text-right font-mono">{row.utilizationPercent}%</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card title="When we are busy" description="Confirmed bookings by start hour.">
          {histogram.length === 0 ? (
            <EmptyState title="Not enough data yet." />
          ) : (
            <ul className="space-y-1">
              {histogram.map((row) => (
                <li key={row.hour} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 font-mono text-navy-700">
                    {String(row.hour).padStart(2, "0")}:00
                  </span>
                  <span className="flex-1">
                    <span
                      className="block h-4 rounded bg-navy-600"
                      style={{ width: `${Math.round((row.count / peakCount) * 100)}%` }}
                      role="img"
                      aria-label={`${row.count} bookings starting at ${row.hour}:00`}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-navy-700">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Compliance"
          description="The liability gates, and who is about to fall out of them."
        >
          {expiring.length === 0 && missingAgreements.length === 0 ? (
            <Alert tone="success" title="Everything current">
              No certificates expiring in the next {COI_WARNING_DAYS} days, and every coaching
              account has a signed agreement on file.
            </Alert>
          ) : (
            <div className="space-y-4">
              {expiring.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-navy-800">
                    Certificates of insurance expiring within {COI_WARNING_DAYS} days
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {expiring.map((doc) => (
                      <li key={doc.id} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {doc.booking?.organization?.name ??
                            doc.booking?.requester.name ??
                            "Unattached certificate"}
                        </span>
                        <span className="font-mono text-navy-700">
                          expires {doc.expiresAt?.toDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {missingAgreements.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-navy-800">
                    Coaching accounts without a current Annual Coach Agreement
                  </h3>
                  <p className="mb-2 text-sm text-navy-600">
                    These accounts cannot create any booking until they sign.
                  </p>
                  <ul className="space-y-1 text-sm">
                    {missingAgreements.map((u) => (
                      <li key={u.id} className="flex flex-wrap justify-between gap-2">
                        <span>{u.name}</span>
                        <span className="text-navy-600">{u.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function RevenueTable({ rows, emptyLabel }: { rows: RevenueRow[]; emptyLabel: string }) {
  if (rows.length === 0) return <EmptyState title={emptyLabel} />;

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th className="text-right">Bookings</Th>
            <Th className="text-right">Gross</Th>
            <Th className="text-right">Refunded</Th>
            <Th className="text-right">Net</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <Td className="font-medium">{row.label}</Td>
              <Td className="text-right">{row.bookings}</Td>
              <Td className="text-right font-mono">{formatMoney(row.grossCents)}</Td>
              <Td className="text-right font-mono">
                {row.refundedCents > 0 ? `−${formatMoney(row.refundedCents)}` : "—"}
              </Td>
              <Td className="text-right font-mono font-semibold">{formatMoney(row.netCents)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
