import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, EmptyState, PageHeader, Table, TableWrap, Td, Th } from "@/components/ui";
import { dateColumnToISO, formatRange } from "@/lib/time";
import { describeRecurrence } from "@/domain/recurrence";
import { previewSeasonAllocation } from "@/services/allocation-service";
import { AllocationBuilder } from "./allocation-builder";
import { PublishSeasonForm } from "./publish-form";

export const metadata: Metadata = { title: "Season allocation" };

export default async function AllocationPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const user = await requirePermission("season:manage");
  const params = await searchParams;

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const seasonId = params.season ?? seasons[0]?.id;

  const [sports, facilities, coaches] = await Promise.all([
    prisma.sport.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.facility.findMany({
      where: { active: true },
      include: { subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["HEAD_COACH", "ASSISTANT_COACH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const blocks = seasonId
    ? await prisma.standingBlock.findMany({
        where: { seasonId },
        include: { sport: true, subSpace: { include: { facility: true } }, createdBy: true },
        orderBy: [{ startTime: "asc" }],
      })
    : [];

  const preview = seasonId ? await previewSeasonAllocation(seasonId) : null;
  const season = seasons.find((s) => s.id === seasonId);
  const approvedCount = blocks.filter((b) => b.status === ApprovalStatus.APPROVED).length;
  const pendingCount = blocks.filter((b) => b.status === ApprovalStatus.PENDING).length;

  const spaces = facilities.flatMap((f) =>
    f.subSpaces.map((s) => ({ id: s.id, label: `${f.name} — ${s.name}` })),
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Season allocation"
        description="Lay down each team's standing practice time, resolve every collision, then publish. Publishing writes real bookings and opens the remaining time as inventory."
      />

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy-800">Season</span>
            <select
              name="season"
              defaultValue={seasonId}
              className="rounded-md border border-navy-300 px-3 py-2 text-sm"
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.published ? "(published)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Open season
          </button>
        </form>
      </Card>

      {!season ? (
        <Card>
          <EmptyState title="No seasons defined yet">
            Create a season before allocating standing blocks.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card
            title={season.name}
            description={`${dateColumnToISO(season.startDate)} to ${dateColumnToISO(season.endDate)}`}
            action={season.published ? <Badge tone="good">Published</Badge> : <Badge tone="warn">Draft</Badge>}
          >
            {preview && (
              <p className="text-sm text-navy-700">
                {approvedCount} approved standing block{approvedCount === 1 ? "" : "s"} expanding to{" "}
                <strong>{preview.occurrences.length}</strong> session
                {preview.occurrences.length === 1 ? "" : "s"} across the season.
              </p>
            )}
            {pendingCount > 0 && (
              <p className="mt-1 text-sm text-navy-700">
                {pendingCount} coach request{pendingCount === 1 ? "" : "s"} awaiting review in the{" "}
                <Link href="/admin/approvals" className="font-medium underline">
                  approval queue
                </Link>
                . Undecided requests are not part of this preview and will not publish.
              </p>
            )}
          </Card>

          {preview && preview.report.collisions.length > 0 ? (
            <Card
              title={`${preview.report.collisions.length} collision${preview.report.collisions.length === 1 ? "" : "s"} to resolve`}
              description="Nothing publishes until every one of these is cleared."
            >
              <Alert tone="danger" title="Two things want the same space at the same time">
                Change one side&apos;s day, time or space — or move it to a sub-space that does not
                overlap the other. The suggestion column shows which side the priority ranking
                favours.
              </Alert>

              <div className="mt-3">
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>This</Th>
                        <Th>Collides with</Th>
                        <Th>Priority favours</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.report.collisions.slice(0, 100).map((collision, i) => (
                        <tr key={i}>
                          <Td className="whitespace-nowrap font-mono text-xs">{collision.date}</Td>
                          <Td>
                            {collision.left.blockLabel}
                            <span className="block text-xs text-navy-600">
                              {formatRange(collision.left.startAt, collision.left.endAt)}
                            </span>
                          </Td>
                          <Td>
                            {"blockLabel" in collision.right
                              ? collision.right.blockLabel
                              : `${collision.right.title} (${collision.right.reference})`}
                            <span className="block text-xs text-navy-600">
                              {formatRange(collision.right.startAt, collision.right.endAt)}
                            </span>
                          </Td>
                          <Td>
                            {collision.suggested === "tie" ? (
                              <Badge tone="warn">Equal — decide manually</Badge>
                            ) : (
                              <Badge>
                                {collision.suggested === "left" ? "This block" : "The other side"}
                              </Badge>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
                {preview.report.collisions.length > 100 && (
                  <p className="mt-2 text-sm text-navy-600">
                    Showing the first 100 of {preview.report.collisions.length}. They usually share a
                    root cause — fixing one block often clears many rows.
                  </p>
                )}
              </div>
            </Card>
          ) : (
            preview && (
              <Card title="No collisions">
                <Alert tone="success" title="Ready to publish">
                  All {preview.occurrences.length} sessions fit without overlapping. Publishing
                  creates them as confirmed bookings.
                </Alert>
                <div className="mt-3">
                  <PublishSeasonForm seasonId={season.id} published={season.published} />
                </div>
              </Card>
            )
          )}

          <Card
            title="Standing blocks"
            description="Recurring time reserved for a team. Coach requests join once approved; denied ones stay for the record."
          >
            {blocks.length === 0 ? (
              <EmptyState title="No blocks yet">Add the first one below.</EmptyState>
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Sport</Th>
                      <Th>Level</Th>
                      <Th>Space</Th>
                      <Th>Pattern</Th>
                      <Th>Time</Th>
                      <Th>Priority</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((block) => (
                      <tr key={block.id}>
                        <Td>{block.sport.name}</Td>
                        <Td className="capitalize">{block.teamLevel.replace("_", " ").toLowerCase()}</Td>
                        <Td>
                          {block.subSpace.facility.name}
                          <span className="block text-xs text-navy-600">{block.subSpace.name}</span>
                        </Td>
                        <Td>
                          {describeRecurrence(block.rrule)}
                          {(block.startDate || block.endDate) && (
                            <span className="block text-xs text-navy-600">
                              {block.startDate ? dateColumnToISO(block.startDate) : "season start"}{" "}
                              to {block.endDate ? dateColumnToISO(block.endDate) : "season end"}
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap font-mono text-xs">
                          {block.startTime}–{block.endTime}
                        </Td>
                        <Td>{block.priority}</Td>
                        <Td>
                          {block.status === ApprovalStatus.PENDING && (
                            <Badge tone="warn">Awaiting review</Badge>
                          )}
                          {block.status === ApprovalStatus.DENIED && (
                            <Badge tone="danger">Denied</Badge>
                          )}
                          {block.status === ApprovalStatus.APPROVED &&
                            (block.published ? <Badge tone="good">Published</Badge> : <Badge>Approved</Badge>)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>

          <Card title="Add a standing block">
            <AllocationBuilder
              seasonId={season.id}
              sports={sports.map((s) => ({ id: s.id, name: s.name }))}
              spaces={spaces}
              coaches={coaches}
            />
          </Card>
        </div>
      )}
    </AppShell>
  );
}
