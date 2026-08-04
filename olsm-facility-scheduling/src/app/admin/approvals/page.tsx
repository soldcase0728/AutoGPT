import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { headCoachSportIds, requireUser } from "@/lib/auth/current-user";
import { isAdmin } from "@/lib/auth/rbac";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { SOFT_LOCK_STATES } from "@/domain/booking-state";
import { MAX_ACTIVE_HOLDS_PER_REQUESTER } from "@/services/booking-service";
import { dateColumnToISO, formatRange } from "@/lib/time";
import { formatMoney } from "@/domain/pricing";
import { ACTIVITY_LABELS } from "@/domain/rules-engine";
import { describeRecurrence } from "@/domain/recurrence";
import { indexSubSpaces, occupiedSubSpaceIds, type SubSpaceNode } from "@/domain/conflict-graph";
import { findConflicts } from "@/services/booking-service";
import {
  previewStandingBlockRequest,
  type StandingBlockRequestPreview,
} from "@/services/allocation-service";
import { ApprovalDecision } from "./approval-decision";
import { StandingBlockDecision } from "./standing-block-decision";

export const metadata: Metadata = { title: "Approval queue" };

export default async function ApprovalsPage() {
  const user = await requireUser();
  const admin = isAdmin(user.role);
  const mySports = headCoachSportIds(user);

  // A head coach sees only the requests routed to them personally; an admin
  // sees the whole queue.
  const steps = await prisma.approvalStep.findMany({
    where: {
      status: ApprovalStatus.PENDING,
      ...(admin
        ? {}
        : { OR: [{ requiredUserId: user.id }, { booking: { sportId: { in: mySports } } }] }),
    },
    include: {
      booking: {
        include: {
          requester: true,
          organization: true,
          sport: true,
          subSpace: { include: { facility: true } },
          invoices: true,
          requirements: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const allSubSpaces = await prisma.subSpace.findMany({ where: { active: true } });
  const index = indexSubSpaces(allSubSpaces as SubSpaceNode[]);

  // Show the approver what else is competing for the slot before they decide.
  const conflictsByStep = new Map<string, Awaited<ReturnType<typeof findConflicts>>>();
  for (const step of steps) {
    const occupied = occupiedSubSpaceIds(step.booking.subSpaceId, index);
    const conflicts = await findConflicts(
      occupied,
      step.booking.startAt,
      step.booking.endAt,
      step.booking.id,
    );
    if (conflicts.length > 0) conflictsByStep.set(step.id, conflicts);
  }

  // Accounts sitting on more holds than the cap allows.
  //
  // The cap is enforced when a booking is created, but two simultaneous
  // submissions from one account can still both pass it -- a known,
  // low-severity defect recorded in the skipped concurrency test. Rather than
  // claim a guarantee the database does not yet make, surface the overage here
  // so an administrator can see it and release the extra hold. Holds also
  // expire on their own, so this is a tidy-up rather than an emergency.
  const overCap = admin
    ? await prisma.booking.groupBy({
        by: ["requesterId"],
        where: {
          status: { in: [...SOFT_LOCK_STATES] },
          OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }],
        },
        _count: { _all: true },
        having: { requesterId: { _count: { gt: MAX_ACTIVE_HOLDS_PER_REQUESTER } } },
      })
    : [];

  // Only the accounts the grouping actually flagged, with their counts.
  const overCapAccounts =
    overCap.length > 0
      ? await prisma.user
          .findMany({
            where: { id: { in: overCap.map((row) => row.requesterId) } },
            select: { id: true, name: true },
          })
          .then((users) =>
            users.map((u) => ({
              ...u,
              holds: overCap.find((row) => row.requesterId === u.id)?._count._all ?? 0,
            })),
          )
      : [];

  // Coaches' standing time requests. Season-scale claims are the athletic
  // office's call, so head coaches do not see this section.
  const blockRequests = admin
    ? await prisma.standingBlock.findMany({
        where: { status: ApprovalStatus.PENDING },
        include: {
          sport: true,
          season: true,
          createdBy: true,
          subSpace: { include: { facility: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const requestPreviews = new Map<string, StandingBlockRequestPreview>();
  for (const request of blockRequests) {
    requestPreviews.set(request.id, await previewStandingBlockRequest(request.id));
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Approval queue"
        description={
          admin
            ? "Requests waiting on the athletic office. Approving does not confirm a booking that still owes documents or payment."
            : "Requests from your assistant coaches waiting on your OK."
        }
      />

      {overCapAccounts.length > 0 && (
        <div className="mb-5">
          <Alert
            tone="warn"
            title={`${overCapAccounts.length} account${overCapAccounts.length === 1 ? "" : "s"} hold more slots than the limit allows`}
          >
            <p>
              The per-account limit is {MAX_ACTIVE_HOLDS_PER_REQUESTER}. Two requests submitted at
              the same moment can both pass that check, so an account can end up one over. The extra
              hold expires on its own; release it sooner from the account&apos;s bookings if the slot
              is wanted.
            </p>
            <ul className="mt-2 list-inside list-disc">
              {overCapAccounts.map((u) => (
                <li key={u.id}>
                  {u.name} — {u.holds} active holds
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      {blockRequests.length > 0 && (
        <div className="mb-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-600">
            Standing time requests
          </h2>
          {blockRequests.map((request) => {
            const preview = requestPreviews.get(request.id);
            return (
              <Card
                key={request.id}
                title={`${request.sport.name} ${request.teamLevel.replace("_", " ").toLowerCase()} — ${request.subSpace.facility.name}, ${request.subSpace.name}`}
                description={`Requested by ${request.createdBy.name}`}
                action={<Badge tone="warn">Awaiting review</Badge>}
              >
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-navy-600">Pattern</dt>
                    <dd className="font-medium">
                      {describeRecurrence(request.rrule)}, {request.startTime}–{request.endTime}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-navy-600">Season</dt>
                    <dd className="font-medium">
                      {request.season.name}
                      {(request.startDate || request.endDate) && (
                        <span className="block text-xs font-normal text-navy-600">
                          {request.startDate ? dateColumnToISO(request.startDate) : "season start"}{" "}
                          to {request.endDate ? dateColumnToISO(request.endDate) : "season end"}
                        </span>
                      )}
                    </dd>
                  </div>
                  {preview && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-navy-600">Claims</dt>
                      <dd className="font-medium">
                        {preview.sessions} session{preview.sessions === 1 ? "" : "s"}
                        {preview.firstDate && preview.lastDate && (
                          <span className="block text-xs font-normal text-navy-600">
                            {preview.firstDate} to {preview.lastDate}
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                  {request.requestNote && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-navy-600">
                        Coach&apos;s note
                      </dt>
                      <dd>{request.requestNote}</dd>
                    </div>
                  )}
                </dl>

                {preview && preview.collisionCount > 0 && (
                  <div className="mt-3">
                    <Alert
                      tone="warn"
                      title={`${preview.collisionCount} session${preview.collisionCount === 1 ? " collides" : "s collide"} with time already claimed`}
                    >
                      <ul className="list-inside list-disc">
                        {preview.collisions.map((c, i) => (
                          <li key={i}>
                            {c.date}: {c.withLabel} — {formatRange(c.startAt, c.endAt)}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1">
                        {request.season.published
                          ? "Approving books every clear day and skips these; the coach is told which days were skipped."
                          : "Approving admits the block to the draft allocation, where these must be resolved before the season publishes."}
                      </p>
                    </Alert>
                  </div>
                )}
                {preview && preview.collisionCount === 0 && (
                  <p className="mt-3 text-sm text-navy-700">
                    <span className="font-medium">No collisions.</span>{" "}
                    {request.season.published
                      ? "Approving books every session now."
                      : "Approving admits the block to the draft allocation; sessions are booked when the season publishes."}
                  </p>
                )}

                <div className="mt-4">
                  <StandingBlockDecision blockId={request.id} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {steps.length === 0 && blockRequests.length === 0 ? (
        <Card>
          <EmptyState title="Nothing waiting">
            Everything submitted has been decided. New requests appear here and by email.
          </EmptyState>
        </Card>
      ) : steps.length === 0 ? null : (
        <div className="space-y-4">
          {steps.map((step) => {
            const booking = step.booking;
            const invoice = booking.invoices[0];
            const conflicts = conflictsByStep.get(step.id);

            return (
              <Card
                key={step.id}
                title={booking.title}
                description={`${booking.reference} · requested by ${booking.requester.name}`}
                action={<StatusBadge status={booking.status} />}
              >
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-navy-600">When</dt>
                    <dd className="font-medium">{formatRange(booking.startAt, booking.endAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-navy-600">Where</dt>
                    <dd className="font-medium">
                      {booking.subSpace.facility.name} — {booking.subSpace.name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-navy-600">Activity</dt>
                    <dd>
                      <Badge>{ACTIVITY_LABELS[booking.activityType]}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-navy-600">Organization</dt>
                    <dd>{booking.organization?.name ?? "—"}</dd>
                  </div>
                  {booking.headcount > 0 && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-navy-600">Headcount</dt>
                      <dd>{booking.headcount}</dd>
                    </div>
                  )}
                  {invoice && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-navy-600">Invoice</dt>
                      <dd className="font-medium">
                        {formatMoney(invoice.totalCents)}{" "}
                        <span className="font-normal text-navy-600">({invoice.status.toLowerCase()})</span>
                      </dd>
                    </div>
                  )}
                </dl>

                {booking.requirements && (
                  <p className="mt-3 text-sm text-navy-700">
                    <span className="font-medium">Still required after approval:</span>{" "}
                    {[
                      booking.requirements.requiresContract && "signed contract",
                      booking.requirements.requiresWaiver && "liability waiver",
                      booking.requirements.requiresCoi && "certificate of insurance",
                      booking.requirements.requiresPayment && "payment in full",
                    ]
                      .filter(Boolean)
                      .join(", ") || "nothing — approving confirms this booking"}
                    .
                  </p>
                )}

                {conflicts && conflicts.length > 0 && (
                  <div className="mt-3">
                    <Alert tone="warn" title="Something else is holding this slot">
                      <ul className="list-inside list-disc">
                        {conflicts.map((c) => (
                          <li key={c.id}>
                            {c.title} ({c.reference}, {c.requesterName}) —{" "}
                            {formatRange(c.startAt, c.endAt)}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1">
                        Approving will not overwrite them. Cancel the conflicting booking first, or
                        use the bump flow from{" "}
                        <Link href="/book" className="underline">
                          Book a space
                        </Link>
                        .
                      </p>
                    </Alert>
                  </div>
                )}

                <div className="mt-4">
                  <ApprovalDecision stepId={step.id} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

export const dynamic = "force-dynamic";
