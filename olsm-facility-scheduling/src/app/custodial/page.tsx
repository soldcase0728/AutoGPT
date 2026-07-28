import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { instantToLocalDate, instantToLocalTime, shiftISODate, startOfLocalDay } from "@/lib/time";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { setupBoard } from "@/services/reporting-service";
import { MaintenanceForm } from "./maintenance-form";
import { CheckInButton } from "./check-in-button";

export const metadata: Metadata = { title: "Setup board" };

export default async function CustodialPage() {
  const user = await requirePermission("setup-board:view");

  const todayISO = instantToLocalDate(new Date());
  const from = startOfLocalDay(todayISO);
  const to = startOfLocalDay(shiftISODate(todayISO, 2));

  const bookings = await setupBoard(from, to);
  const facilities = await prisma.facility.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  // Group by day, then by building — that is how the work actually gets done.
  const days = [todayISO, shiftISODate(todayISO, 1)];
  const grouped = new Map<string, Map<string, typeof bookings>>();
  for (const day of days) grouped.set(day, new Map());

  for (const booking of bookings) {
    const day = instantToLocalDate(booking.startAt);
    const byFacility = grouped.get(day);
    if (!byFacility) continue;
    const key = booking.subSpace.facility.name;
    const list = byFacility.get(key) ?? [];
    list.push(booking);
    byFacility.set(key, list);
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Daily setup board"
        description="Today and tomorrow, grouped by building. Turnover time between bookings is already reserved."
      />

      <div className="space-y-5">
        {days.map((day, i) => {
          const byFacility = grouped.get(day)!;
          const total = [...byFacility.values()].reduce((n, list) => n + list.length, 0);

          return (
            <Card
              key={day}
              title={i === 0 ? "Today" : "Tomorrow"}
              description={`${new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(`${day}T12:00:00Z`))} · ${total} booking${total === 1 ? "" : "s"}`}
            >
              {total === 0 ? (
                <EmptyState title="Nothing scheduled" />
              ) : (
                <div className="space-y-5">
                  {[...byFacility.entries()].map(([facilityName, list]) => (
                    <div key={facilityName}>
                      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-700">
                        {facilityName}
                      </h3>
                      <ul className="space-y-2">
                        {list.map((booking, index) => {
                          const previous = list[index - 1];
                          const turnoverMinutes = previous
                            ? Math.round(
                                (booking.startAt.getTime() - previous.endAt.getTime()) / 60_000,
                              )
                            : null;

                          return (
                            <li
                              key={booking.id}
                              className="rounded-md border border-navy-200 p-3"
                            >
                              {turnoverMinutes !== null && turnoverMinutes >= 0 && (
                                <p className="mb-2 text-xs font-medium text-gold-800">
                                  {turnoverMinutes} minute turnover from the previous booking
                                </p>
                              )}
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium text-navy-900">
                                    {instantToLocalTime(booking.startAt)}–
                                    {instantToLocalTime(booking.endAt)} · {booking.subSpace.name}
                                  </p>
                                  <p className="text-sm text-navy-700">{booking.title}</p>
                                  <p className="text-sm text-navy-600">
                                    {booking.requester.name}
                                    {booking.requester.phone ? ` · ${booking.requester.phone}` : ""}
                                    {booking.headcount ? ` · ${booking.headcount} people` : ""}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge>{ACTIVITY_LABELS[booking.activityType]}</Badge>
                                  <CheckInButton
                                    bookingId={booking.id}
                                    status={booking.status}
                                    startAt={booking.startAt.toISOString()}
                                  />
                                </div>
                              </div>

                              {booking.setupNotes && (
                                <div className="mt-2 rounded bg-gold-50 p-2 text-sm text-gold-950">
                                  <span className="font-semibold">Setup: </span>
                                  {booking.setupNotes}
                                </div>
                              )}
                              {booking.equipmentNotes && (
                                <div className="mt-2 rounded bg-navy-50 p-2 text-sm text-navy-800">
                                  <span className="font-semibold">Equipment: </span>
                                  {booking.equipmentNotes}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}

        <Card
          title="Mark a space unavailable"
          description="Maintenance, repairs, floor refinishing. This blocks bookings for the window immediately."
        >
          <Alert tone="info">
            A maintenance block behaves like any other reservation: nobody can book over it, and the
            block is recorded in the audit log.
          </Alert>
          <div className="mt-3">
            <MaintenanceForm facilities={facilities.map((f) => ({ id: f.id, name: f.name }))} />
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
