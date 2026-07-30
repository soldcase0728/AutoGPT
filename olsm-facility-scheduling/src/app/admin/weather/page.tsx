import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Card, EmptyState, PageHeader, Table, TableWrap, Td, Th } from "@/components/ui";
import { formatRange, instantToLocalDate } from "@/lib/time";
import { formatMoney } from "@/domain/pricing";
import { previewWeatherImpact, weatherDependentFacilities } from "@/services/weather-service";
import { WeatherCancelForm } from "./weather-cancel-form";

export const metadata: Metadata = { title: "Weather cancellation" };

export default async function WeatherPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string; date?: string }>;
}) {
  const user = await requireAdmin();
  const params = await searchParams;

  const facilities = await weatherDependentFacilities();
  const facilityId = params.facility ?? facilities[0]?.id;
  const dateISO = params.date ?? instantToLocalDate(new Date());

  const impacted = facilityId ? await previewWeatherImpact(facilityId, dateISO) : [];
  const facility = facilities.find((f) => f.id === facilityId);
  const totalPaid = impacted.reduce((sum, i) => sum + i.paidCents, 0);
  const reachableBySms = impacted.filter((i) => i.smsOptIn && i.requesterPhone).length;

  return (
    <AppShell user={user}>
      <PageHeader
        title="Weather cancellation"
        description="Close an outdoor facility for a day in one action. Everyone affected is refunded in full and told immediately."
      />

      {facilities.length === 0 ? (
        <Card>
          <EmptyState title="No weather-dependent facilities">
            Mark a facility as weather dependent in Admin → Facilities to use this.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-navy-800">Facility</span>
                <select
                  name="facility"
                  defaultValue={facilityId}
                  className="rounded-md border border-navy-300 px-3 py-2 text-sm"
                >
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-navy-800">Date</span>
                <input
                  type="date"
                  name="date"
                  defaultValue={dateISO}
                  className="rounded-md border border-navy-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
              >
                Show what is booked
              </button>
            </form>
          </Card>

          <Card
            title={`${impacted.length} booking${impacted.length === 1 ? "" : "s"} would be cancelled`}
            description={facility ? `${facility.name} · ${dateISO}` : undefined}
          >
            {impacted.length === 0 ? (
              <EmptyState title="Nothing booked that day">
                No action needed for this facility and date.
              </EmptyState>
            ) : (
              <>
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Time</Th>
                        <Th>Booking</Th>
                        <Th>Space</Th>
                        <Th>Contact</Th>
                        <Th className="text-right">Refund</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {impacted.map((row) => (
                        <tr key={row.bookingId}>
                          <Td className="whitespace-nowrap">{formatRange(row.startAt, row.endAt)}</Td>
                          <Td>
                            {row.title}
                            <span className="block font-mono text-xs text-navy-500">
                              {row.reference}
                            </span>
                          </Td>
                          <Td>{row.subSpaceName}</Td>
                          <Td className="text-xs">
                            {row.requesterName}
                            <span className="block text-navy-600">
                              {row.smsOptIn && row.requesterPhone
                                ? `${row.requesterPhone} · SMS`
                                : "email only"}
                            </span>
                          </Td>
                          <Td className="text-right font-mono">
                            {row.paidCents > 0 ? formatMoney(row.paidCents) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>

                <div className="mt-4">
                  <Alert tone="warn" title="What this does">
                    Cancels all {impacted.length} bookings, refunds{" "}
                    {totalPaid > 0 ? formatMoney(totalPaid) : "nothing (none are paid)"} in full
                    regardless of the usual cancellation window, removes them from the facility
                    calendar, emails every organizer and texts the {reachableBySms} who have opted
                    into SMS. It cannot be undone in one action — restoring means rebooking each
                    group.
                  </Alert>
                </div>

                <div className="mt-4">
                  <WeatherCancelForm
                    facilityId={facilityId!}
                    facilityName={facility?.name ?? ""}
                    dateISO={dateISO}
                    count={impacted.length}
                  />
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
