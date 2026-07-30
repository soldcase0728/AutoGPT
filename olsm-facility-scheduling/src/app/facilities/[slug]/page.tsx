import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PublicShell } from "@/components/app-shell";
import { Badge, Card, EmptyState, PageHeader, Table, TableWrap, Td, Th } from "@/components/ui";
import { formatRange, instantToLocalDate } from "@/lib/time";
import { formatMoney, RATE_TIER_LABELS } from "@/domain/pricing";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { dayName, parseDefaultHours, type WeekdayKeyList } from "./hours";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const facility = await prisma.facility.findUnique({ where: { slug } });
  return { title: facility?.name ?? "Facility", robots: { index: false } };
}

export default async function FacilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const facility = await prisma.facility.findUnique({
    where: { slug },
    include: {
      subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } },
      rateCards: { where: { effectiveTo: null } },
    },
  });

  if (!facility || !facility.active) notFound();

  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 86_400_000);

  // What the public may see: times and space only, never requester details.
  const upcoming = await prisma.booking.findMany({
    where: {
      subSpace: { facilityId: facility.id },
      startAt: { gte: now, lt: horizon },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
    },
    include: { subSpace: true },
    orderBy: { startAt: "asc" },
    take: 60,
  });

  // Closures matter as much as bookings: a facility shut for maintenance is not
  // open, and showing only bookings would imply it is. The reason text is
  // admin-entered and may name people or internal detail, so it is never shown
  // here -- only that the space is closed.
  const closures = await prisma.blackout.findMany({
    where: {
      OR: [{ facilityId: facility.id }, { subSpace: { facilityId: facility.id } }],
      startAt: { lt: horizon },
      endAt: { gt: now },
    },
    include: { subSpace: true },
    orderBy: { startAt: "asc" },
    take: 60,
  });

  // One list, ordered by time, so a reader sees the whole committed picture
  // rather than two half-pictures they have to merge themselves.
  const committed = [
    ...upcoming.map((b) => ({
      id: b.id,
      startAt: b.startAt,
      endAt: b.endAt,
      space: b.subSpace.name,
      label: "Booked" as const,
    })),
    ...closures.map((c) => ({
      id: c.id,
      startAt: c.startAt,
      endAt: c.endAt,
      space: c.subSpace?.name ?? "Whole facility",
      label: "Closed" as const,
    })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const hours = parseDefaultHours(facility.defaultHours);
  const days: WeekdayKeyList = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  const publishedRates = facility.rateCards
    .filter((rc) => rc.hourlyCents > 0)
    .sort((a, b) => a.hourlyCents - b.hourlyCents);

  return (
    <PublicShell>
      <PageHeader
        title={facility.name}
        description={facility.description ?? facility.type}
        action={
          <Link
            href={`/request?facility=${facility.slug}`}
            className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Request this facility
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Spaces">
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Space</Th>
                    <Th>Capacity</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {facility.subSpaces.map((sub) => (
                    <tr key={sub.id}>
                      <Td className="font-medium">{sub.name}</Td>
                      <Td>{sub.capacity}</Td>
                      <Td className="text-navy-600">
                        {sub.blocksIds.length > 0
                          ? "Booking this space closes the smaller spaces inside it."
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          <Card
            title="Rates"
            description="Hourly rates by requester type. Internal school use is not charged."
          >
            {publishedRates.length === 0 ? (
              <EmptyState title="Not available for paid hire" />
            ) : (
              <>
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Use</Th>
                        <Th>Requester type</Th>
                        <Th className="text-right">Hourly</Th>
                        <Th className="text-right">Full day</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {publishedRates.map((rate) => (
                        <tr key={rate.id}>
                          <Td>{ACTIVITY_LABELS[rate.activityType]}</Td>
                          <Td>{RATE_TIER_LABELS[rate.rateTier]}</Td>
                          <Td className="text-right font-mono">{formatMoney(rate.hourlyCents)}</Td>
                          <Td className="text-right font-mono">
                            {rate.flatDayCents ? formatMoney(rate.flatDayCents) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
                <p className="mt-3 text-xs text-navy-600">
                  Rates shown are provisional and subject to confirmation by the athletic office.
                  Lights, custodial setup, supervision and athletic trainer coverage may be charged
                  in addition. External rentals also require a refundable security deposit.
                </p>
              </>
            )}
          </Card>

          <Card
            title="Committed time, next two weeks"
            description="Bookings and closures already on the schedule. This is not the full availability picture — school priority, setup and teardown buffers, and held time are applied when you check a specific date and time."
          >
            {committed.length === 0 ? (
              <EmptyState title="Nothing on the schedule in the next two weeks" />
            ) : (
              <ul className="divide-y divide-navy-100">
                {committed.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-navy-700">{formatRange(entry.startAt, entry.endAt)}</span>
                    <span className="flex items-center gap-2 text-navy-600">
                      {entry.space}
                      <Badge tone={entry.label === "Closed" ? "warn" : undefined}>{entry.label}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm">
              <Link href={`/request?facility=${facility.slug}`} className="font-medium text-navy-800 underline">
                Check a specific date and time
              </Link>
            </p>
            <p className="mt-3 text-xs text-navy-600">
              Subscribe to this facility&apos;s calendar:{" "}
              <Link href={`/api/feeds/${facility.slug}.ics`} className="underline">
                iCal feed
              </Link>
            </p>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="At a glance">
            <div className="flex flex-wrap gap-2">
              <Badge>{facility.indoor ? "Indoor" : "Outdoor"}</Badge>
              <Badge>Capacity {facility.capacity.toLocaleString()}</Badge>
              {facility.weatherDependent && <Badge tone="warn">Weather dependent</Badge>}
              {facility.requiresSupervision && <Badge tone="warn">Supervision required</Badge>}
              {!facility.externallyBookable && <Badge tone="warn">School use only</Badge>}
            </div>

            {facility.amenities.length > 0 && (
              <ul className="mt-3 list-inside list-disc text-sm text-navy-700">
                {facility.amenities.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Published hours">
            <dl className="space-y-1 text-sm">
              {days.map((day) => (
                <div key={day} className="flex justify-between gap-3">
                  <dt className="text-navy-600">{dayName(day)}</dt>
                  <dd className="font-mono text-navy-800">
                    {(hours[day] ?? []).length === 0
                      ? "Closed"
                      : hours[day]!.map((w) => `${w.open}–${w.close}`).join(", ")}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-navy-600">
              Requests outside these hours can still be made; the athletic office decides case by
              case. Setup and teardown of {facility.bufferMinutes} minutes is reserved around every
              booking.
            </p>
          </Card>

          <Card title="Weather">
            {facility.weatherDependent ? (
              <p className="text-sm text-navy-700">
                This is an outdoor space. Bookings cancelled by the school for weather are refunded
                in full regardless of the usual cancellation window.
              </p>
            ) : (
              <p className="text-sm text-navy-700">Indoor space; not weather dependent.</p>
            )}
          </Card>
        </aside>
      </div>

      <p className="mt-6 text-xs text-navy-500">
        Availability shown as of {instantToLocalDate(now)}.
      </p>
    </PublicShell>
  );
}
