import type { Metadata } from "next";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, sportIds } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Card, EmptyState, PageHeader, StatusBadge, Table, TableWrap, Td, Th } from "@/components/ui";
import { formatRange } from "@/lib/time";
import { describeRecurrence } from "@/domain/recurrence";
import { ReleaseButton } from "./release-button";

export const metadata: Metadata = { title: "My team" };

export default async function MyTeamPage() {
  const user = await requireUser();
  const mySports = sportIds(user);

  const upcoming = await prisma.booking.findMany({
    where: {
      sportId: { in: mySports },
      endAt: { gte: new Date() },
      status: {
        in: [
          BookingStatus.PENDING_APPROVAL,
          BookingStatus.APPROVED,
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
        ],
      },
    },
    include: { subSpace: { include: { facility: true } }, sport: true, standingBlock: true },
    orderBy: { startAt: "asc" },
    take: 60,
  });

  const blocks = await prisma.standingBlock.findMany({
    where: { sportId: { in: mySports } },
    include: { sport: true, season: true, subSpace: { include: { facility: true } } },
    orderBy: { startTime: "asc" },
  });

  return (
    <AppShell user={user}>
      <PageHeader
        title="My team's schedule"
        description="Release a standing block you do not need and the time goes straight back to open inventory — anyone waiting on that window is told automatically."
      />

      <div className="space-y-5">
        <Card
          title="Standing blocks"
          description="Recurring practice time allocated to your team for the season."
        >
          {blocks.length === 0 ? (
            <EmptyState title="No standing blocks allocated">
              The athletic office allocates recurring practice time before each season opens.
            </EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Sport</Th>
                    <Th>Space</Th>
                    <Th>Pattern</Th>
                    <Th>Time</Th>
                    <Th>Season</Th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((block) => (
                    <tr key={block.id}>
                      <Td>
                        {block.sport.name}
                        <span className="block text-xs text-navy-600">
                          {block.teamLevel.replace("_", " ").toLowerCase()}
                        </span>
                      </Td>
                      <Td>
                        {block.subSpace.facility.name}
                        <span className="block text-xs text-navy-600">{block.subSpace.name}</span>
                      </Td>
                      <Td>{describeRecurrence(block.rrule)}</Td>
                      <Td className="font-mono text-xs">
                        {block.startTime}–{block.endTime}
                      </Td>
                      <Td>
                        {block.season.name}
                        {!block.published && (
                          <span className="block text-xs text-gold-800">not yet published</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card title="Upcoming sessions" description="The next 60 bookings for your teams.">
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing scheduled yet" />
          ) : (
            <ul className="divide-y divide-navy-100">
              {upcoming.map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-navy-900">{booking.title}</p>
                    <p className="text-sm text-navy-600">
                      {formatRange(booking.startAt, booking.endAt)} ·{" "}
                      {booking.subSpace.facility.name} — {booking.subSpace.name}
                    </p>
                  </div>
                  <StatusBadge status={booking.status} />
                  {booking.standingBlockId && (
                    <ReleaseButton bookingId={booking.id} label={formatRange(booking.startAt, booking.endAt)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
