/**
 * Booking service -- the centre of the system.
 *
 * `createBooking` is one path for every kind of request. A head coach booking
 * an in-season practice and an outside company renting the stadium go through
 * the same function; the only thing that differs is which gates their rule row
 * turns on. That is what keeps the two behaviours consistent: there is no
 * "fast path" that could quietly skip the liability check.
 *
 * Order of operations, and why:
 *   1. Annual Coach Agreement    -- an out-of-compliance account books nothing
 *   2. Permission and scope      -- can this person book this space at all
 *   3. Availability              -- hours, blackouts, sanity (admin-overridable)
 *   4. Rule selection            -- activity type first, role second
 *   5. Conflict + bump           -- who is in the way, can this request bump them
 *   6. Persist                   -- booking, occupancy, gates, approvals, invoice
 *   7. Advance                   -- land on the correct state, sync if CONFIRMED
 */

import {
  ActivityType,
  ApprovalStatus,
  BookingStatus,
  DocumentStatus,
  DocumentType,
  Prisma,
  RateTier,
  Role,
  TeamLevel,
  type Booking,
  type Rule,
} from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { ComplianceError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { formatRange } from "@/lib/time";
import { allowedActivityTypes, canBookFacility, isAdmin } from "@/lib/auth/rbac";
import {
  indexSubSpaces,
  occupiedSubSpaceIds,
  paddedWindow,
  type SubSpaceNode,
} from "@/domain/conflict-graph";
import {
  hasSoftLock,
  holdsSlot,
  nextStatus,
  SOFT_LOCK_STATES,
  type GateFlags,
} from "@/domain/booking-state";
import { approvalsClearedAtCreation, gatesFromRule, requiredDocumentTypes, selectRule } from "@/domain/rules-engine";
import { assessBump, computePriority, type BumpCandidate } from "@/domain/priority";
import { resolveRateTier } from "@/domain/pricing";
import { checkAnnualAgreement, checkBookingDocuments } from "@/domain/compliance";
import {
  checkBlackouts,
  checkOperatingHours,
  checkSanity,
  parseDefaultHours,
  type AvailabilityIssue,
} from "@/domain/availability";
import { enqueue } from "./job-queue";
import { createInvoiceForBooking, refundInvoiceForCancellation } from "./invoice-service";
import { prepareBookingDocuments } from "./document-service";
import { notifyBookingStateChange, notifyBumped } from "./notification-service";

export interface Actor {
  id: string;
  name: string;
  role: Role;
  ipAddress?: string | null;
}

export interface CreateBookingInput {
  requesterId: string;
  subSpaceId: string;
  activityType: ActivityType;
  title: string;
  startAt: Date;
  endAt: Date;
  headcount?: number;
  sportId?: string | null;
  teamLevel?: TeamLevel;
  organizationId?: string | null;
  seasonId?: string | null;
  standingBlockId?: string | null;
  parentBookingId?: string | null;
  setupNotes?: string | null;
  equipmentNotes?: string | null;
  supervisorId?: string | null;
  /** Admin only: proceed despite closed hours / blackout / past date. */
  overrideAvailability?: boolean;
  /** Admin only: confirm bumping the lower-priority bookings in the way. */
  confirmBump?: boolean;
}

export interface CreateBookingResult {
  booking: Booking;
  status: BookingStatus;
  gates: GateFlags;
  bumped: BumpCandidate[];
  warnings: string[];
  /** Set when the booking needs money; the UI sends the requester here. */
  invoiceId?: string;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createBooking(
  input: CreateBookingInput,
  actor: Actor,
): Promise<CreateBookingResult> {
  const warnings: string[] = [];

  const requester = await prisma.user.findUnique({
    where: { id: input.requesterId },
    include: { organization: true, documents: true, sports: true },
  });
  if (!requester) throw new NotFoundError("Requester");
  if (!requester.active) throw new ForbiddenError("That account is deactivated.");

  const subSpace = await prisma.subSpace.findUnique({
    where: { id: input.subSpaceId },
    include: { facility: true },
  });
  if (!subSpace || !subSpace.active) throw new NotFoundError("Sub-space");

  // --- 1. Annual Coach Agreement -------------------------------------------
  // Acceptance criterion 3. Checked against the requester, not the actor: an
  // admin creating a booking on a coach's behalf does not launder the gate.
  const agreement = checkAnnualAgreement(requester.role, requester.documents);
  if (!agreement.ok) {
    throw new ComplianceError(agreement.message ?? "Annual agreement required.", {
      label: "Sign your Annual Coach Agreement",
      href: "/my-documents",
    });
  }

  // --- 2. Permission and scope ---------------------------------------------
  if (!canBookFacility(
    { role: requester.role, facilityScope: requester.facilityScope },
    subSpace.facility,
  )) {
    throw new ForbiddenError(
      `${subSpace.facility.name} is not available to your account. ` +
        "Ask the athletic office if you need access.",
    );
  }

  const permittedActivities = allowedActivityTypes(
    isAdmin(actor.role) ? actor.role : requester.role,
  );
  if (!permittedActivities.includes(input.activityType)) {
    throw new ForbiddenError(`Your role cannot request a ${input.activityType} booking.`);
  }

  if (
    subSpace.facility.requiresSupervision &&
    !input.supervisorId &&
    input.activityType !== ActivityType.MAINTENANCE
  ) {
    throw new ValidationError(
      `${subSpace.facility.name} requires a supervision-qualified staff member to be named on the booking.`,
    );
  }
  if (input.supervisorId) {
    await assertSupervisorQualified(input.supervisorId, subSpace.facility.supervisionRoles);
  }

  // --- 3. Availability ------------------------------------------------------
  const issues: AvailabilityIssue[] = [
    ...checkSanity(input.startAt, input.endAt),
  ];

  const hoursIssue = checkOperatingHours(
    input.startAt,
    input.endAt,
    parseDefaultHours(subSpace.facility.defaultHours),
  );
  if (hoursIssue) issues.push(hoursIssue);

  const blackouts = await prisma.blackout.findMany({
    where: {
      OR: [{ facilityId: subSpace.facilityId }, { subSpaceId: subSpace.id }],
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
  });
  const blackoutIssue = checkBlackouts(input.startAt, input.endAt, blackouts);
  if (blackoutIssue) issues.push(blackoutIssue);

  const canOverride = isAdmin(actor.role) && input.overrideAvailability === true;
  for (const issue of issues) {
    if (!issue.overridable || !canOverride) {
      if (!issue.overridable) throw new ValidationError(issue.message);
      if (!isAdmin(actor.role)) throw new ValidationError(issue.message);
      // Admin who has not yet confirmed the override.
      throw new ValidationError(`${issue.message} An administrator can override this.`);
    }
    warnings.push(`Override: ${issue.message}`);
  }

  // --- 4. Rule selection ----------------------------------------------------
  const rules = await prisma.rule.findMany();
  const { rule } = selectRule(rules, input.activityType, requester.role);
  const gates = gatesFromRule(rule);
  const teamLevel = input.teamLevel ?? TeamLevel.NONE;
  const priority = computePriority(rule, teamLevel);

  if (rule.mhsaaComplianceFlag) {
    warnings.push(
      "MHSAA out-of-season contact rules may apply to this booking. Confirm against the " +
        "current MHSAA handbook before the activity takes place.",
    );
  }

  // --- 5. Conflicts and bumping --------------------------------------------
  const allSubSpaces = await prisma.subSpace.findMany({ where: { active: true } });
  const index = indexSubSpaces(allSubSpaces as SubSpaceNode[]);
  const occupied = occupiedSubSpaceIds(subSpace.id, index);

  const facilityBuffers = new Map(
    (await prisma.facility.findMany({ select: { id: true, bufferMinutes: true } })).map((f) => [
      f.id,
      f.bufferMinutes,
    ]),
  );
  const padded = paddedWindow(input.startAt, input.endAt, occupied, index, facilityBuffers);

  // Release stale soft locks first so an abandoned request does not hold a slot
  // hostage until the next sweep.
  await releaseExpiredHolds();

  const conflicts = await findConflicts(occupied, padded.start, padded.end);
  let bumped: BumpCandidate[] = [];

  if (conflicts.length > 0) {
    const assessment = assessBump(priority, conflicts);

    if (assessment.blocking.length > 0) {
      // Offer somewhere to go rather than only saying no. Suggestions are a
      // courtesy, so a failure to compute them must not replace the conflict
      // message with a different error.
      const alternatives = await suggestAlternatives(
        subSpace.id,
        input.startAt,
        input.endAt,
      ).catch(() => []);

      throw new ConflictError(buildConflictMessage(assessment.blocking, subSpace.name), {
        conflicts: assessment.blocking,
        alternatives,
      });
    }

    // Everything in the way is outranked. Bumping is never automatic.
    if (!isAdmin(actor.role) || !input.confirmBump) {
      throw new ConflictError(
        `This request outranks ${assessment.bumpable.length} existing booking(s) in ${subSpace.name}. ` +
          "An administrator must confirm the bump.",
        { bumpable: assessment.bumpable, requiresConfirmation: true },
      );
    }

    bumped = assessment.bumpable;
  }

  // --- 6 & 7. Persist and advance ------------------------------------------
  const reference = await nextReference();
  const rateTier = resolveRateTier(input.activityType, requester.organization?.rateTier);

  const created = await prisma.$transaction(async (tx) => {
    // Bump first so the slot is free before the exclusion constraint fires.
    for (const victim of bumped) {
      await releaseBooking(tx, victim.id, BookingStatus.CANCELLED, {
        actor,
        reason: `Bumped by higher-priority booking ${reference}.`,
        bumpedBy: reference,
      });
    }

    const booking = await tx.booking.create({
      data: {
        reference,
        requesterId: requester.id,
        organizationId: input.organizationId ?? requester.organizationId,
        subSpaceId: subSpace.id,
        sportId: input.sportId ?? null,
        seasonId: input.seasonId ?? null,
        standingBlockId: input.standingBlockId ?? null,
        parentBookingId: input.parentBookingId ?? null,
        activityType: input.activityType,
        teamLevel,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        headcount: input.headcount ?? 0,
        status: BookingStatus.DRAFT,
        priority,
        setupNotes: input.setupNotes ?? null,
        equipmentNotes: input.equipmentNotes ?? null,
        supervisorId: input.supervisorId ?? null,
      },
    });

    await tx.bookingRequirement.create({
      data: {
        bookingId: booking.id,
        requiresAdminApproval: gates.requiresAdminApproval,
        requiresHeadCoachApproval: gates.requiresHeadCoachApproval,
        requiresContract: gates.requiresContract,
        requiresWaiver: gates.requiresWaiver,
        requiresCoi: gates.requiresCoi,
        requiresPayment: gates.requiresPayment,
        autoApprove: rule.autoApprove,
        // Snapshot: later edits to the rules table must not retroactively
        // change what an already-cleared booking was required to do.
        ruleSnapshot: rule as unknown as Prisma.InputJsonValue,
      },
    });

    await writeOccupancy(tx, booking.id, occupied, padded.start, padded.end);

    if (!approvalsClearedAtCreation(rule)) {
      await createApprovalSteps(tx, booking.id, rule, requester.id, input.sportId ?? null);
    }

    await recordAudit(
      {
        entityType: "booking",
        entityId: booking.id,
        action: "booking.created",
        actorId: actor.id,
        actorLabel: actor.name,
        toState: BookingStatus.DRAFT,
        ipAddress: actor.ipAddress,
        payload: {
          reference,
          activityType: input.activityType,
          subSpaceId: subSpace.id,
          occupiedSubSpaceIds: occupied,
          bufferMinutes: padded.bufferMinutes,
          priority,
          ruleId: rule.id,
          gates: gates as unknown as Prisma.InputJsonValue,
          warnings,
          bumped: bumped.map((b) => b.reference),
        } as Prisma.InputJsonValue,
      },
      tx,
    );

    return booking;
  }).catch(translateOverlapError);

  // Documents and invoice live outside the creation transaction: both call out
  // to third parties, and neither should be able to roll back a valid booking.
  if (gates.requiresContract || gates.requiresWaiver || gates.requiresCoi) {
    await prepareBookingDocuments(created.id, requiredDocumentTypes(gates, input.activityType) as DocumentType[]);
  }

  let invoiceId: string | undefined;
  if (gates.requiresPayment) {
    const invoice = await createInvoiceForBooking(created.id, rateTier, actor);
    invoiceId = invoice?.id;
  }

  // Refund the bumped parties, then tell them. Deliberately after the
  // transaction has committed: a refund is not reversible, so it must not be
  // issued for a bump that then rolls back. The cancellation window is waived
  // -- someone bumped for a school activity did nothing wrong and is made whole
  // regardless of how close to the date it is.
  for (const victim of bumped) {
    const refund = await refundInvoiceForCancellation(victim.id, actor, { waivePolicy: true });
    await notifyBumped({ ...victim, paidAmountCents: refund.refundCents }, reference, actor);
  }

  const advanced = await advanceBooking(created.id, actor);

  return {
    booking: advanced.booking,
    status: advanced.booking.status,
    gates,
    bumped,
    warnings,
    invoiceId,
  };
}

// ---------------------------------------------------------------------------
// Advancing through the gates
// ---------------------------------------------------------------------------

export interface AdvanceResult {
  booking: Booking;
  changed: boolean;
  outstanding: string[];
}

/**
 * Recompute where a booking belongs and move it there. Called after every event
 * that could clear a gate: an approval decision, a signed envelope, a Stripe
 * webhook, an admin accepting a COI.
 */
export async function advanceBooking(bookingId: string, actor: Actor): Promise<AdvanceResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      requirements: true,
      approvals: true,
      documents: true,
      invoices: true,
      subSpace: { include: { facility: true } },
    },
  });
  if (!booking) throw new NotFoundError("Booking");
  if (!booking.requirements) throw new ValidationError("Booking is missing its requirement record.");

  // Terminal bookings never move again.
  if (!holdsSlot(booking.status) && booking.status !== BookingStatus.DRAFT) {
    return { booking, changed: false, outstanding: [] };
  }

  const gates: GateFlags = {
    requiresAdminApproval: booking.requirements.requiresAdminApproval,
    requiresHeadCoachApproval: booking.requirements.requiresHeadCoachApproval,
    requiresContract: booking.requirements.requiresContract,
    requiresWaiver: booking.requirements.requiresWaiver,
    requiresCoi: booking.requirements.requiresCoi,
    requiresPayment: booking.requirements.requiresPayment,
  };

  const outstanding: string[] = [];

  const approvalsCleared =
    booking.requirements.autoApprove ||
    booking.approvals.length === 0 ||
    booking.approvals.every((a) => a.status === ApprovalStatus.APPROVED || a.status === ApprovalStatus.SKIPPED);
  if (!approvalsCleared) outstanding.push("Approval");

  const requiredDocs = requiredDocumentTypes(gates, booking.activityType) as DocumentType[];
  const docCheck = checkBookingDocuments(requiredDocs, booking.documents, booking.endAt);
  if (!docCheck.cleared) {
    outstanding.push(...docCheck.outstanding.map((o) => `${o.label}: ${o.reason}`));
  }

  const paymentCleared =
    !gates.requiresPayment ||
    booking.invoices.some((i) => i.status === "PAID" || i.totalCents === 0);
  if (!paymentCleared) outstanding.push("Payment");

  const target = nextStatus(gates, {
    approvalsCleared,
    documentsCleared: docCheck.cleared,
    paymentCleared,
  });

  if (target === booking.status) {
    return { booking, changed: false, outstanding };
  }

  const holdExpiresAt = computeHoldExpiry(target, booking.requirements.ruleSnapshot);

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: target,
      holdExpiresAt,
      calendarSyncStatus: target === BookingStatus.CONFIRMED ? "PENDING" : booking.calendarSyncStatus,
    },
  });

  await recordAudit({
    entityType: "booking",
    entityId: booking.id,
    action: "booking.status_changed",
    actorId: actor.id,
    actorLabel: actor.name,
    fromState: booking.status,
    toState: target,
    reason: outstanding.length > 0 ? `Outstanding: ${outstanding.join("; ")}` : "All gates cleared.",
    ipAddress: actor.ipAddress,
  });

  if (target === BookingStatus.CONFIRMED) {
    // Only CONFIRMED reaches Google Calendar.
    await enqueue({
      kind: "calendar.upsert",
      payload: { bookingId: booking.id },
      idempotencyKey: `calendar:upsert:${booking.id}:${booking.calendarSyncVersion + 1}`,
    });
  }

  await notifyBookingStateChange(booking.id, booking.status, target);

  return { booking: updated, changed: true, outstanding };
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function decideApproval(
  approvalStepId: string,
  decision: "APPROVED" | "DENIED",
  actor: Actor,
  note?: string,
): Promise<AdvanceResult> {
  const step = await prisma.approvalStep.findUnique({
    where: { id: approvalStepId },
    include: { booking: true },
  });
  if (!step) throw new NotFoundError("Approval step");
  if (step.status !== ApprovalStatus.PENDING) {
    throw new ValidationError("That approval has already been decided.");
  }

  const permitted =
    isAdmin(actor.role) ||
    (step.requiredUserId ? step.requiredUserId === actor.id : step.requiredRole === actor.role);
  if (!permitted) throw new ForbiddenError("You are not the approver for this request.");

  await prisma.approvalStep.update({
    where: { id: step.id },
    data: {
      status: decision === "APPROVED" ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED,
      approverId: actor.id,
      decidedAt: new Date(),
      note: note ?? null,
    },
  });

  await recordAudit({
    entityType: "booking",
    entityId: step.bookingId,
    action: decision === "APPROVED" ? "booking.approved" : "booking.denied",
    actorId: actor.id,
    actorLabel: actor.name,
    reason: note ?? null,
    ipAddress: actor.ipAddress,
  });

  if (decision === "DENIED") {
    const booking = await releaseBookingAtomic(step.bookingId, BookingStatus.DENIED, {
      actor,
      reason: note ?? "Denied by approver.",
    });
    await notifyBookingStateChange(step.bookingId, step.booking.status, BookingStatus.DENIED);
    return { booking, changed: true, outstanding: [] };
  }

  return advanceBooking(step.bookingId, actor);
}

// ---------------------------------------------------------------------------
// Cancellation, expiry, completion
// ---------------------------------------------------------------------------

export interface CancelResult {
  booking: Booking;
  refundCents: number;
  refundRationale: string;
}

export async function cancelBooking(
  bookingId: string,
  reason: string,
  actor: Actor,
  options: { waiveCancellationPolicy?: boolean } = {},
): Promise<CancelResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { requirements: true, invoices: true },
  });
  if (!booking) throw new NotFoundError("Booking");

  const isOwner = booking.requesterId === actor.id;
  if (!isOwner && !isAdmin(actor.role)) {
    throw new ForbiddenError("Only the requester or an administrator can cancel this booking.");
  }
  if (!holdsSlot(booking.status) && booking.status !== BookingStatus.DRAFT) {
    throw new ValidationError(`A ${booking.status} booking cannot be cancelled.`);
  }

  const refund = await refundInvoiceForCancellation(booking.id, actor, {
    waivePolicy: options.waiveCancellationPolicy ?? false,
  });

  const updated = await releaseBookingAtomic(bookingId, BookingStatus.CANCELLED, {
    actor,
    reason,
    refundCents: refund.refundCents,
    refundRationale: refund.rationale,
  });

  await notifyBookingStateChange(bookingId, booking.status, BookingStatus.CANCELLED);

  return { booking: updated, refundCents: refund.refundCents, refundRationale: refund.rationale };
}

/**
 * Sweep soft locks whose window elapsed. Called before every conflict check and
 * by the scheduled job, so an abandoned request releases its slot promptly.
 */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<number> {
  const expired = await prisma.booking.findMany({
    where: {
      status: { in: [...SOFT_LOCK_STATES] },
      holdExpiresAt: { not: null, lt: now },
    },
    select: { id: true, status: true, reference: true },
  });

  for (const booking of expired) {
    await releaseBookingAtomic(booking.id, BookingStatus.EXPIRED, {
      actor: { id: "system", name: "System", role: Role.SUPER_ADMIN },
      reason: "Soft lock expired before the outstanding documents or payment were completed.",
    });
    await notifyBookingStateChange(booking.id, booking.status, BookingStatus.EXPIRED);
  }

  return expired.length;
}

export async function checkIn(bookingId: string, actor: Actor): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking");
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new ValidationError("Only a confirmed booking can be checked in.");
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.CHECKED_IN, checkedInAt: new Date() },
  });

  await recordAudit({
    entityType: "booking",
    entityId: bookingId,
    action: "booking.checked_in",
    actorId: actor.id,
    actorLabel: actor.name,
    fromState: booking.status,
    toState: BookingStatus.CHECKED_IN,
    ipAddress: actor.ipAddress,
  });

  return updated;
}

export async function markNoShow(bookingId: string, actor: Actor): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking");
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new ValidationError("Only a confirmed booking can be marked as a no-show.");
  }
  return releaseBookingAtomic(bookingId, BookingStatus.NO_SHOW, {
    actor,
    reason: "Marked as a no-show.",
  });
}

/** Close out bookings whose end time has passed. Nightly job. */
export async function completePastBookings(now: Date = new Date()): Promise<number> {
  const due = await prisma.booking.findMany({
    where: {
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
      endAt: { lt: now },
    },
    select: { id: true, status: true },
  });

  for (const booking of due) {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.COMPLETED, holdExpiresAt: null },
      });
      // Occupancy is retained for reporting until completion, then dropped so
      // the exclusion index stays small.
      await tx.bookingOccupancy.deleteMany({ where: { bookingId: booking.id } });
      await recordAudit(
        {
          entityType: "booking",
          entityId: booking.id,
          action: "booking.completed",
          actorId: null,
          actorLabel: "system",
          fromState: booking.status,
          toState: BookingStatus.COMPLETED,
        },
        tx,
      );
    });
  }

  return due.length;
}

// ---------------------------------------------------------------------------
// Standing block release (recovering unused gym time)
// ---------------------------------------------------------------------------

export async function releaseStandingBlockOccurrence(
  bookingId: string,
  actor: Actor,
): Promise<Booking> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { standingBlock: true },
  });
  if (!booking) throw new NotFoundError("Booking");
  if (!booking.standingBlockId) {
    throw new ValidationError("That booking is not part of a standing block.");
  }

  const isOwner = booking.requesterId === actor.id;
  if (!isOwner && !isAdmin(actor.role)) {
    throw new ForbiddenError("Only the owning coach or an administrator can release this block.");
  }

  const released = await releaseBookingAtomic(bookingId, BookingStatus.CANCELLED, {
    actor,
    reason: "Standing block released back to open inventory by the coach.",
  });

  const { notifyWaitlistForWindow } = await import("./waitlist-service");
  await notifyWaitlistForWindow(booking.subSpaceId, booking.startAt, booking.endAt);

  return released;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export interface ConflictRow {
  bookingId: string;
  reference: string;
  title: string;
  priority: number;
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  requesterName: string;
  requesterEmail: string;
  subSpaceName: string;
}

/**
 * Bookings currently holding any of the given sub-spaces during the window.
 * The database exclusion constraint is what actually prevents the overlap; this
 * query exists to tell the user *who* is in the way and to decide bumping.
 */
export async function findConflicts(
  subSpaceIds: readonly string[],
  start: Date,
  end: Date,
  excludeBookingId?: string,
): Promise<BumpCandidate[]> {
  const rows = await prisma.bookingOccupancy.findMany({
    where: {
      subSpaceId: { in: [...subSpaceIds] },
      startAt: { lt: end },
      endAt: { gt: start },
      booking: {
        status: { in: [...HOLDING_STATUSES] },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
    },
    include: {
      booking: {
        include: {
          requester: true,
          invoices: true,
        },
      },
      subSpace: true,
    },
  });

  const byBooking = new Map<string, BumpCandidate>();
  for (const row of rows) {
    if (byBooking.has(row.bookingId)) continue;
    const paid = row.booking.invoices.find((i) => i.status === "PAID");
    byBooking.set(row.bookingId, {
      id: row.booking.id,
      reference: row.booking.reference,
      title: row.booking.title,
      priority: row.booking.priority,
      status: row.booking.status,
      startAt: row.booking.startAt,
      endAt: row.booking.endAt,
      requesterName: row.booking.requester.name,
      requesterEmail: row.booking.requester.email,
      paidInvoiceId: paid?.id ?? null,
      paidAmountCents: paid ? paid.totalCents - paid.refundedCents : 0,
    });
  }

  return [...byBooking.values()];
}

const HOLDING_STATUSES = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.AWAITING_DOCUMENTS,
  BookingStatus.AWAITING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
] as const;

async function writeOccupancy(
  tx: Tx,
  bookingId: string,
  subSpaceIds: readonly string[],
  start: Date,
  end: Date,
): Promise<void> {
  await tx.bookingOccupancy.createMany({
    data: subSpaceIds.map((subSpaceId) => ({
      bookingId,
      subSpaceId,
      startAt: start,
      endAt: end,
    })),
  });
}

/**
 * Move a booking to a non-holding state and drop its occupancy rows in one
 * transaction, so the slot is never released without the status changing (or
 * the reverse).
 */
export interface ReleaseContext {
  actor: Actor;
  reason: string;
  refundCents?: number;
  refundRationale?: string;
  bumpedBy?: string;
}

/** Release in its own transaction, for callers that are not already in one. */
async function releaseBookingAtomic(
  bookingId: string,
  to: BookingStatus,
  context: ReleaseContext,
): Promise<Booking> {
  return prisma.$transaction((tx) => releaseBooking(tx, bookingId, to, context));
}

/** Release inside an existing transaction. */
async function releaseBooking(
  tx: Tx,
  bookingId: string,
  to: BookingStatus,
  context: ReleaseContext,
): Promise<Booking> {
  const existing = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!existing) throw new NotFoundError("Booking");

  const updated = await tx.booking.update({
    where: { id: bookingId },
    data: {
      status: to,
      holdExpiresAt: null,
      cancelledAt: new Date(),
      cancelReason: context.reason,
      calendarSyncStatus: existing.googleEventId ? "PENDING" : existing.calendarSyncStatus,
    },
  });

  await tx.bookingOccupancy.deleteMany({ where: { bookingId } });

  if (existing.googleEventId) {
    await enqueue(
      {
        kind: "calendar.delete",
        payload: {
          calendarId: existing.googleCalendarId,
          eventId: existing.googleEventId,
          bookingId,
        },
        idempotencyKey: `calendar:delete:${bookingId}`,
      },
      tx,
    );
  }

  await recordAudit(
    {
      entityType: "booking",
      entityId: bookingId,
      action: context.bumpedBy ? "booking.bumped" : `booking.${to.toLowerCase()}`,
      actorId: context.actor.id === "system" ? null : context.actor.id,
      actorLabel: context.actor.name,
      fromState: existing.status,
      toState: to,
      reason: context.reason,
      ipAddress: context.actor.ipAddress,
      payload: {
        refundCents: context.refundCents ?? 0,
        refundRationale: context.refundRationale ?? null,
        bumpedBy: context.bumpedBy ?? null,
      } as Prisma.InputJsonValue,
    },
    tx,
  );

  return updated;
}

async function createApprovalSteps(
  tx: Tx,
  bookingId: string,
  rule: Rule,
  requesterId: string,
  sportId: string | null,
): Promise<void> {
  const steps: Prisma.ApprovalStepCreateManyInput[] = [];

  if (rule.requiresHeadCoachApproval && sportId) {
    // Route to the head coach of the requester's sport. An assistant coach's
    // routine practice request is a one-click OK, not an admin queue item.
    const headCoach = await tx.coachAssignment.findFirst({
      where: { sportId, isHead: true, user: { active: true } },
      include: { user: true },
    });

    if (headCoach && headCoach.userId !== requesterId) {
      steps.push({
        bookingId,
        requiredUserId: headCoach.userId,
        requiredRole: Role.HEAD_COACH,
        sequence: 0,
      });
    }
    // A head coach requesting under their own sport does not approve themselves;
    // the step is simply not created and the gate falls through to admin (or to
    // nothing, if the rule requires no admin approval).
  }

  if (rule.requiresAdminApproval) {
    steps.push({
      bookingId,
      requiredRole: Role.FACILITY_ADMIN,
      sequence: steps.length,
    });
  }

  if (steps.length > 0) await tx.approvalStep.createMany({ data: steps });
}

async function assertSupervisorQualified(
  supervisorId: string,
  supervisionRoles: readonly Role[],
): Promise<void> {
  const supervisor = await prisma.user.findUnique({ where: { id: supervisorId } });
  if (!supervisor || !supervisor.active) throw new ValidationError("The named supervisor is not an active user.");
  if (supervisionRoles.length === 0) return;
  if (!supervisionRoles.includes(supervisor.role) && !isAdmin(supervisor.role)) {
    throw new ValidationError(
      `${supervisor.name} is not qualified to supervise this space. ` +
        `Qualified roles: ${supervisionRoles.join(", ")}.`,
    );
  }
}

function computeHoldExpiry(status: BookingStatus, ruleSnapshot: Prisma.JsonValue): Date | null {
  if (!hasSoftLock(status)) return null;
  const snapshot = (ruleSnapshot ?? {}) as { documentHoldHours?: number; paymentHoldHours?: number };
  const hours =
    status === BookingStatus.AWAITING_PAYMENT
      ? (snapshot.paymentHoldHours ?? 120)
      : (snapshot.documentHoldHours ?? 72);
  return new Date(Date.now() + hours * 3_600_000);
}

function buildConflictMessage(blocking: readonly BumpCandidate[], subSpaceName: string): string {
  const first = blocking[0];
  const more = blocking.length > 1 ? ` (and ${blocking.length - 1} more)` : "";
  return `${subSpaceName} is already held by ${first.title} — ${formatRange(first.startAt, first.endAt)}${more}.`;
}

/** A free slot offered in place of one that was taken. */
export interface Alternative {
  subSpaceId: string;
  label: string;
  startAt: Date;
  endAt: Date;
  /** Why this is being offered, e.g. "Same space, 2 hours later". */
  reason: string;
}

/**
 * Free slots near a request that could not be met.
 *
 * "That time is taken" is a dead end: the person now has to guess again, and
 * every guess costs another round trip. This looks in the three directions
 * someone would look themselves -- the same space earlier or later that day,
 * the same time on the following days, and the other spaces in the same
 * facility at the requested time -- and offers the first few that are actually
 * clear.
 *
 * Every candidate goes through the same padded-window and conflict check the
 * real booking would, so an offered slot is one the server would accept rather
 * than one that merely looks free. Operating hours are honoured too, so this
 * never proposes six in the morning just because nothing is booked then.
 */
export async function suggestAlternatives(
  subSpaceId: string,
  startAt: Date,
  endAt: Date,
  limit = 4,
): Promise<Alternative[]> {
  const durationMs = endAt.getTime() - startAt.getTime();
  if (durationMs <= 0) return [];

  const subSpace = await prisma.subSpace.findUnique({
    where: { id: subSpaceId },
    include: { facility: { include: { subSpaces: { where: { active: true } } } } },
  });
  if (!subSpace) return [];

  const allSubSpaces = await prisma.subSpace.findMany({ where: { active: true } });
  const index = indexSubSpaces(allSubSpaces as SubSpaceNode[]);
  const facilityBuffers = new Map(
    (await prisma.facility.findMany({ select: { id: true, bufferMinutes: true } })).map((f) => [
      f.id,
      f.bufferMinutes,
    ]),
  );
  const hours = parseDefaultHours(subSpace.facility.defaultHours);

  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  const candidates: Omit<Alternative, "label">[] = [];

  // Same space, shifted within the day. Nearest offsets first.
  for (const offsetHours of [1, -1, 2, -2, 3, -3]) {
    candidates.push({
      subSpaceId,
      startAt: new Date(startAt.getTime() + offsetHours * HOUR),
      endAt: new Date(endAt.getTime() + offsetHours * HOUR),
      reason:
        offsetHours > 0
          ? `Same space, ${offsetHours} hour${offsetHours === 1 ? "" : "s"} later`
          : `Same space, ${-offsetHours} hour${offsetHours === -1 ? "" : "s"} earlier`,
    });
  }

  // Same space and time, following days.
  for (const days of [1, 2, 3, 7]) {
    candidates.push({
      subSpaceId,
      startAt: new Date(startAt.getTime() + days * DAY),
      endAt: new Date(endAt.getTime() + days * DAY),
      reason: days === 7 ? "Same space and time, next week" : `Same space and time, ${days} day${days === 1 ? "" : "s"} later`,
    });
  }

  // Sibling spaces in the same facility, at the time originally wanted.
  for (const sibling of subSpace.facility.subSpaces) {
    if (sibling.id === subSpaceId) continue;
    candidates.push({
      subSpaceId: sibling.id,
      startAt,
      endAt,
      reason: "Same time, different space",
    });
  }

  const nameById = new Map(subSpace.facility.subSpaces.map((s) => [s.id, s.name]));
  const found: Alternative[] = [];
  const now = new Date();

  for (const candidate of candidates) {
    if (found.length >= limit) break;
    if (candidate.startAt <= now) continue;
    if (checkOperatingHours(candidate.startAt, candidate.endAt, hours)) continue;

    const occupied = occupiedSubSpaceIds(candidate.subSpaceId, index);
    const padded = paddedWindow(
      candidate.startAt,
      candidate.endAt,
      occupied,
      index,
      facilityBuffers,
    );
    const clashes = await findConflicts(occupied, padded.start, padded.end);
    if (clashes.length > 0) continue;

    found.push({
      ...candidate,
      label: `${subSpace.facility.name} — ${nameById.get(candidate.subSpaceId) ?? subSpace.name}`,
    });
  }

  return found;
}

/**
 * The exclusion constraint firing means two requests raced past the pre-flight
 * check. Turn it into the same error the pre-flight check would have raised.
 */
function translateOverlapError(error: unknown): never {
  const code =
    typeof error === "object" && error !== null
      ? ((error as { code?: string; meta?: { code?: string } }).meta?.code ??
        (error as { code?: string }).code)
      : undefined;

  const message = error instanceof Error ? error.message : "";

  if (code === "23P01" || /booking_occupancy_no_overlap/.test(message)) {
    throw new ConflictError(
      "That space was taken while you were filling this in. Refresh and pick another slot.",
    );
  }
  throw error;
}

/**
 * Human-quotable booking reference, e.g. OLSM-20260731-000042.
 * Backed by a Postgres sequence so two simultaneous requests cannot collide.
 */
export async function nextReference(now: Date = new Date()): Promise<string> {
  const stamp =
    `${now.getUTCFullYear()}` +
    `${String(now.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(now.getUTCDate()).padStart(2, "0")}`;

  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('booking_reference_seq') AS nextval
  `;
  const seq = Number(rows[0]?.nextval ?? 1);
  return `OLSM-${stamp}-${String(seq).padStart(6, "0")}`;
}
