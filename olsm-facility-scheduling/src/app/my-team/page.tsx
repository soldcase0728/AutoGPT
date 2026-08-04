import type { Metadata } from "next";
import { ApprovalStatus, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { headCoachSportIds, requireUser, sportIds } from "@/lib/auth/current-user";
import { canBookFacility } from "@/lib/auth/rbac";
import { AppShell } from "@/components/app-shell";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { dateColumnToISO, formatRange, instantToLocalDate } from "@/lib/time";
import { describeRecurrence } from "@/domain/recurrence";
import { ReleaseButton } from "./release-button";
import { RequestBlockForm } from "./request-block-form";
import { WithdrawButton } from "./withdraw-button";

export const metadata: Metadata = { title: "My team" };

export default async function MyTeamPage() {
  const user = await requireUser();
  const mySports = sportIds(user);
  const myHeadSports = headCoachSportIds(user);

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
    orderBy: [{ createdAt: "desc" }],
  });

  // The request form, for head coaches while at least one season is open.
  const canRequest = myHeadSports.length > 0;
  const today = new Date(`${instantToLocalDate(new Date())}T00:00:00Z`);
  const openSeasons = canRequest
    ? await prisma.season.findMany({
        where: { endDate: { gte: today } },
        orderBy: { startDate: "asc" },
      })
    : [];
  const facilities = canRequest
    ? await prisma.facility.findMany({
        where: { active: true },
        include: { subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { name: "asc" },
      })
    : [];
  const spaces = facilities
    .filter((f) => canBookFacility({ role: user.role, facilityScope: user.facilityScope }, f))
    .flatMap((f) => f.subSpaces.map((s) => ({ id: s.id, label: `${f.name} — ${s.name}` })));

  return (
    <AppShell user={user}>
      <PageHeader
        title="My team's schedule"
        description="Release a standing block you do not need and the time goes straight back to open inventory — anyone waiting on that window is told automatically."
      />

      <div className="space-y-5">
        <Card
          title="Standing blocks"
          description="Recurring practice time for your team — allocated by the athletic office, or requested below and awaiting their review."
        >
          {blocks.length === 0 ? (
            <EmptyState title="No standing blocks yet">
              {canRequest
                ? "Request your team's recurring practice time below and the athletic office will review it."
                : "The athletic office allocates recurring practice time before each season opens."}
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
                    <Th>Status</Th>
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
                      <Td>
                        {describeRecurrence(block.rrule)}
                        {(block.startDate || block.endDate) && (
                          <span className="block text-xs text-navy-600">
                            {block.startDate ? dateColumnToISO(block.startDate) : "season start"} to{" "}
                            {block.endDate ? dateColumnToISO(block.endDate) : "season end"}
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-xs">
                        {block.startTime}–{block.endTime}
                      </Td>
                      <Td>{block.season.name}</Td>
                      <Td>
                        {block.status === ApprovalStatus.PENDING && (
                          <div className="space-y-1.5">
                            <Badge tone="warn">Awaiting review</Badge>
                            {block.createdById === user.id && <WithdrawButton blockId={block.id} />}
                          </div>
                        )}
                        {block.status === ApprovalStatus.DENIED && (
                          <div className="space-y-1">
                            <Badge tone="danger">Not approved</Badge>
                            {block.decisionNote && (
                              <span className="block max-w-xs text-xs text-navy-600">
                                {block.decisionNote}
                              </span>
                            )}
                          </div>
                        )}
                        {block.status === ApprovalStatus.APPROVED &&
                          (block.published ? (
                            <Badge tone="good">On the calendar</Badge>
                          ) : (
                            <div className="space-y-1">
                              <Badge tone="good">Approved</Badge>
                              <span className="block text-xs text-gold-800">
                                on the calendar when the season publishes
                              </span>
                            </div>
                          ))}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        {canRequest && openSeasons.length > 0 && (
          <Card
            title="Request standing practice time"
            description="Tell the athletic office when your team practices — the days, the time, and the stretch of the season it covers. Nothing is reserved until they approve it."
          >
            <RequestBlockForm
              seasons={openSeasons.map((s) => ({
                id: s.id,
                label: `${s.name} (${dateColumnToISO(s.startDate)} to ${dateColumnToISO(s.endDate)})`,
              }))}
              sports={user.sports
                .filter((assignment) => assignment.isHead)
                .map((assignment) => ({ id: assignment.sportId, name: assignment.sport.name }))}
              spaces={spaces}
            />
          </Card>
        )}

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
