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

  // Rate cards exist for every facility, including the ones outside groups may
  // not book at all -- the schema does not know the difference. Publishing them
  // advertised a price for a space nobody outside the school can hire, next to
  // a request button the server would refuse. Eligibility decides first.
  const publishedRates = facility.externallyBookable
    ? facility.rateCards.filter((rc) => rc.hourlyCents > 0)
    : [];

  // Rates are set per requester type, and within a type they are usually the
  // same whatever the use. Rendering the raw matrix showed sixteen rows for
  // four actual prices, which reads as pricing complexity the school does not
  // charge. Collapse to one row per distinct price and name the uses only when
  // a use genuinely changes what someone pays.
  // When one rate covers every tier and every use -- which is the case under
  // flat pricing -- a table of identical numbers says less than one sentence.
  const singleRate =
    publishedRates.length > 0 &&
    new Set(publishedRates.map((rc) => `${rc.hourlyCents}:${rc.flatDayCents ?? "none"}`)).size === 1
      ? publishedRates[0]
      : null;

  const rateRows = [...new Set(publishedRates.map((rc) => rc.rateTier))]
    .flatMap((tier) => {
      const forTier = publishedRates.filter((rc) => rc.rateTier === tier);
      const byPrice = new Map<string, typeof forTier>();
      for (const rc of forTier) {
        const key = `${rc.hourlyCents}:${rc.flatDayCents ?? "none"}`;
        byPrice.set(key, [...(byPrice.get(key) ?? []), rc]);
      }
      const priceVariesWithUse = byPrice.size > 1;
      return [...byPrice.values()].map((group) => ({
        key: `${tier}-${group[0].hourlyCents}-${group[0].flatDayCents ?? "none"}`,
        tier,
        hourlyCents: group[0].hourlyCents,
        flatDayCents: group[0].flatDayCents,
        appliesTo: priceVariesWithUse
          ? group.map((rc) => ACTIVITY_LABELS[rc.activityType]).sort().join(", ")
          : null,
      }));
    })
    .sort((a, b) => a.hourlyCents - b.hourlyCents);

  return (
    <PublicShell>
      <PageHeader
        title={facility.name}
        description={facility.description ?? facility.type}
        action={
          facility.externallyBookable ? (
            <Link
              href={`/request?facility=${facility.slug}`}
              className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
            >
              Request this facility
            </Link>
          ) : (
            // Offering "Request this facility" here sent people into a form the
            // server would reject. Authorized staff still need a way in, so the
            // action points at sign-in rather than disappearing.
            <Link
              href="/sign-in"
              className="rounded-md border border-navy-300 px-3.5 py-2 text-sm font-medium text-navy-800 hover:bg-navy-50"
            >
              Sign in to book
            </Link>
          )
        }
      />

      {/*
        min-w-0 on both columns. A grid item defaults to min-width:auto, so it
        refuses to shrink below its widest content -- here the rate table's
        min-w-[36rem]. That stretched the column past a phone viewport and put a
        horizontal scrollbar on the whole page, which also defeated the
        overflow-x-auto on TableWrap: it cannot scroll content that has already
        stretched its own ancestor. With min-w-0 the column shrinks and the
        table scrolls inside its card, which is the intended behaviour.
      */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
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
            title={facility.externallyBookable ? "Rates" : "Who can book this space"}
            description={facility.externallyBookable ? "Internal school use is not charged." : undefined}
          >
            {!facility.externallyBookable ? (
              <p className="text-sm text-navy-700">
                Available only to authorized OLSM teams and school programs. This space is not
                offered for outside hire, so no rental rate applies.
              </p>
            ) : publishedRates.length === 0 ? (
              <EmptyState title="Not available for paid hire" />
            ) : singleRate ? (
              <>
                <p className="text-2xl font-semibold text-navy-900">
                  {formatMoney(singleRate.hourlyCents)}{" "}
                  <span className="text-base font-normal text-navy-700">per hour</span>
                </p>
                <p className="mt-1 text-sm text-navy-700">
                  The same rate for any outside group and any type of use
                  {singleRate.flatDayCents
                    ? `, with a full day capped at ${formatMoney(singleRate.flatDayCents)}`
                    : ""}
                  .
                </p>
              </>
            ) : (
              <>
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Requester type</Th>
                        <Th>Applies to</Th>
                        <Th className="text-right">Hourly</Th>
                        <Th className="text-right">Full day</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rateRows.map((row) => (
                        <tr key={row.key}>
                          <Td>{RATE_TIER_LABELS[row.tier]}</Td>
                          <Td>{row.appliesTo ?? "Any external use"}</Td>
                          <Td className="text-right font-mono">{formatMoney(row.hourlyCents)}</Td>
                          <Td className="text-right font-mono">
                            {row.flatDayCents ? formatMoney(row.flatDayCents) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </>
            )}

            {publishedRates.length > 0 && (
              <p className="mt-3 text-xs text-navy-600">
                Lights, custodial setup, supervision and athletic trainer coverage may be charged
                in addition. The athletic office confirms the full amount when it reviews your
                request.
              </p>
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

        <aside className="min-w-0 space-y-5">
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
