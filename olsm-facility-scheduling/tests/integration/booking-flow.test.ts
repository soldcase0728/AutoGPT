/**
 * Acceptance-criteria tests, run against a real PostgreSQL database.
 *
 * These are the tests that matter: they exercise the exclusion constraint, the
 * append-only audit trigger and the full gate sequence, none of which can be
 * verified with mocks.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ActivityType, BookingStatus, DocumentStatus, DocumentType, Role, TeamLevel } from "@prisma/client";
import {
  actorFor,
  db,
  ensureMigrated,
  futureSlot,
  reseedAgreements,
  resetTransactionalData,
  subSpace,
  userByEmail,
} from "../helpers/db";
import {
  advanceBooking,
  cancelBooking,
  createBooking,
  decideApproval,
  releaseExpiredHolds,
} from "@/services/booking-service";
import { markInvoicePaid } from "@/services/invoice-service";
import { recordSignature, uploadCertificateOfInsurance } from "@/services/document-service";
import { ComplianceError, ConflictError } from "@/lib/errors";

beforeAll(() => {
  ensureMigrated();
});

beforeEach(async () => {
  await resetTransactionalData();
  await db.document.deleteMany({});
  await reseedAgreements();
});

// ---------------------------------------------------------------------------
// Acceptance criterion 1: head coach, in-season practice, zero friction
// ---------------------------------------------------------------------------

describe("head coach books an in-season practice", () => {
  it("confirms immediately with no approval, documents or payment", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "full-court");
    const sport = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const { startAt, endAt } = futureSlot(1, 120);

    const result = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Boys Basketball practice",
        startAt,
        endAt,
        sportId: sport.id,
        teamLevel: TeamLevel.VARSITY,
      },
      actorFor(coach),
    );

    expect(result.status).toBe(BookingStatus.CONFIRMED);
    expect(result.gates.requiresContract).toBe(false);
    expect(result.gates.requiresPayment).toBe(false);
    expect(result.gates.requiresAdminApproval).toBe(false);

    // No approval steps, no documents, no invoice were created at all.
    expect(await db.approvalStep.count({ where: { bookingId: result.booking.id } })).toBe(0);
    expect(await db.document.count({ where: { bookingId: result.booking.id } })).toBe(0);
    expect(await db.invoice.count({ where: { bookingId: result.booking.id } })).toBe(0);

    // Confirmed is the only state that reaches Google Calendar: the sync job is
    // queued as part of the same operation.
    const job = await db.jobQueue.findFirst({
      where: { kind: "calendar.upsert", payload: { path: ["bookingId"], equals: result.booking.id } },
    });
    expect(job).not.toBeNull();
  });

  it("routes an assistant coach's practice request to the head coach, not the admin queue", async () => {
    const assistant = await userByEmail("bball.assistant@olsm.edu");
    const head = await userByEmail("bball.head@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "court-1");
    const sport = await db.sport.findUniqueOrThrow({ where: { name: "Boys Basketball" } });
    const { startAt, endAt } = futureSlot(2, 90);

    const result = await createBooking(
      {
        requesterId: assistant.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "JV practice",
        startAt,
        endAt,
        sportId: sport.id,
        teamLevel: TeamLevel.JV,
      },
      actorFor(assistant),
    );

    expect(result.status).toBe(BookingStatus.PENDING_APPROVAL);

    const steps = await db.approvalStep.findMany({ where: { bookingId: result.booking.id } });
    expect(steps).toHaveLength(1);
    expect(steps[0].requiredUserId).toBe(head.id);

    // One click from the head coach and it is confirmed.
    const after = await decideApproval(steps[0].id, "APPROVED", actorFor(head));
    expect(after.booking.status).toBe(BookingStatus.CONFIRMED);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2: the same head coach, running paid private lessons
// ---------------------------------------------------------------------------

describe("head coach books private instruction in the same gym", () => {
  it("requires approval, a contract, a waiver, a COI and payment before confirming", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const admin = await userByEmail("ad@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "full-court");
    const { startAt, endAt } = futureSlot(3, 120);

    const result = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.PRIVATE_INSTRUCTION,
        title: "Saturday skills clinic",
        startAt,
        endAt,
        headcount: 12,
      },
      actorFor(coach),
    );

    // Role bought them nothing: activity type is matched first.
    expect(result.status).toBe(BookingStatus.PENDING_APPROVAL);
    expect(result.gates).toMatchObject({
      requiresAdminApproval: true,
      requiresContract: true,
      requiresWaiver: true,
      requiresCoi: true,
      requiresPayment: true,
    });

    // The slot is held while approval is pending.
    const held = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(held.holdExpiresAt).not.toBeNull();
    expect(await db.bookingOccupancy.count({ where: { bookingId: result.booking.id } })).toBeGreaterThan(0);

    // An internal coach doing paid instruction is billed at the commercial rate,
    // not their organisation's $0 internal rate.
    const invoice = await db.invoice.findFirstOrThrow({ where: { bookingId: result.booking.id } });
    expect(invoice.totalCents).toBeGreaterThan(0);

    // --- admin approves ---
    const step = await db.approvalStep.findFirstOrThrow({ where: { bookingId: result.booking.id } });
    const approved = await decideApproval(step.id, "APPROVED", actorFor(admin));
    expect(approved.booking.status).toBe(BookingStatus.AWAITING_DOCUMENTS);

    // --- contract and waiver signed ---
    const docs = await db.document.findMany({ where: { bookingId: result.booking.id } });
    expect(docs.map((d) => d.type).sort()).toEqual(
      [
        DocumentType.CERTIFICATE_OF_INSURANCE,
        DocumentType.FACILITY_USE_AGREEMENT,
        DocumentType.LIABILITY_WAIVER,
      ].sort(),
    );

    for (const doc of docs.filter((d) => d.type !== DocumentType.CERTIFICATE_OF_INSURANCE)) {
      await recordSignature(doc.id, { name: coach.name, email: coach.email });
    }

    // Still not confirmed: the COI is outstanding.
    let current = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(current.status).toBe(BookingStatus.AWAITING_DOCUMENTS);

    // --- COI uploaded ---
    const coi = docs.find((d) => d.type === DocumentType.CERTIFICATE_OF_INSURANCE)!;
    await uploadCertificateOfInsurance({
      documentId: coi.id,
      file: new TextEncoder().encode("%PDF-1.4 test certificate"),
      filename: "coi.pdf",
      contentType: "application/pdf",
      expiresAt: new Date(endAt.getTime() + 200 * 86_400_000),
      actor: actorFor(admin),
    });

    current = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(current.status).toBe(BookingStatus.AWAITING_PAYMENT);

    // --- payment ---
    await markInvoicePaid(invoice.id, actorFor(admin), { method: "test" });
    const final = await advanceBooking(result.booking.id, actorFor(admin));
    expect(final.booking.status).toBe(BookingStatus.CONFIRMED);
  });

  // Acceptance criterion 8.
  it("blocks confirmation when the COI expires before the event", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const admin = await userByEmail("ad@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "court-2");
    const { startAt, endAt } = futureSlot(4, 60);

    const result = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.PRIVATE_INSTRUCTION,
        title: "Shooting lessons",
        startAt,
        endAt,
      },
      actorFor(coach),
    );

    const step = await db.approvalStep.findFirstOrThrow({ where: { bookingId: result.booking.id } });
    await decideApproval(step.id, "APPROVED", actorFor(admin));

    const docs = await db.document.findMany({ where: { bookingId: result.booking.id } });
    for (const doc of docs.filter((d) => d.type !== DocumentType.CERTIFICATE_OF_INSURANCE)) {
      await recordSignature(doc.id, { name: coach.name, email: coach.email });
    }

    // A certificate valid today but expiring before the booking date.
    const coi = docs.find((d) => d.type === DocumentType.CERTIFICATE_OF_INSURANCE)!;
    await db.document.update({
      where: { id: coi.id },
      data: {
        status: DocumentStatus.UPLOADED,
        expiresAt: new Date(startAt.getTime() - 86_400_000),
      },
    });

    const outcome = await advanceBooking(result.booking.id, actorFor(admin));
    expect(outcome.booking.status).toBe(BookingStatus.AWAITING_DOCUMENTS);
    expect(outcome.outstanding.join(" ")).toMatch(/expires before this booking/i);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3: no annual agreement, no booking
// ---------------------------------------------------------------------------

describe("annual coach agreement enforcement", () => {
  it("stops a coach with no signed agreement from booking anything", async () => {
    const coach = await userByEmail("football.head@olsm.edu");
    await db.document.deleteMany({
      where: { userId: coach.id, type: DocumentType.ANNUAL_COACH_AGREEMENT },
    });

    const field = await subSpace("milewski-field", "full");
    const { startAt, endAt } = futureSlot(5, 90);

    await expect(
      createBooking(
        {
          requesterId: coach.id,
          subSpaceId: field.id,
          activityType: ActivityType.TEAM_PRACTICE,
          title: "Football practice",
          startAt,
          endAt,
        },
        actorFor(coach),
      ),
    ).rejects.toBeInstanceOf(ComplianceError);
  });

  it("stops a coach whose agreement has expired, and points at the signing link", async () => {
    const coach = await userByEmail("football.head@olsm.edu");
    await db.document.updateMany({
      where: { userId: coach.id, type: DocumentType.ANNUAL_COACH_AGREEMENT },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    });

    const field = await subSpace("milewski-field", "full");
    const { startAt, endAt } = futureSlot(6, 90);

    const error = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: field.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Football practice",
        startAt,
        endAt,
      },
      actorFor(coach),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ComplianceError);
    expect((error as ComplianceError).actionHref).toBe("/my-documents");
  });
});

// ---------------------------------------------------------------------------
// Acceptance criteria 4 and 5: overlap and the conflict graph
// ---------------------------------------------------------------------------

describe("overlap prevention", () => {
  it("rejects a second booking of the same sub-space at an overlapping time", async () => {
    const coachA = await userByEmail("bball.head@olsm.edu");
    const coachB = await userByEmail("gbball.head@olsm.edu");
    const court = await subSpace("dombrowski-fieldhouse", "court-a");
    const { startAt, endAt } = futureSlot(7, 120);

    await createBooking(
      {
        requesterId: coachA.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Boys practice",
        startAt,
        endAt,
      },
      actorFor(coachA),
    );

    await expect(
      createBooking(
        {
          requesterId: coachB.id,
          subSpaceId: court.id,
          activityType: ActivityType.TEAM_PRACTICE,
          title: "Girls practice",
          startAt: new Date(startAt.getTime() + 30 * 60_000),
          endAt: new Date(endAt.getTime() + 30 * 60_000),
        },
        actorFor(coachB),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  /**
   * Acceptance criterion 4 explicitly requires that the database rejects this,
   * not only the UI. This test bypasses every application-level check and
   * writes straight to booking_occupancy.
   */
  it("is enforced by a database constraint, not only application code", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const court = await subSpace("dombrowski-fieldhouse", "court-b");
    const { startAt, endAt } = futureSlot(8, 120);

    const first = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Practice",
        startAt,
        endAt,
      },
      actorFor(coach),
    );

    // A second booking row with no occupancy: legal so far.
    const orphan = await db.booking.create({
      data: {
        reference: `TEST-${Date.now()}`,
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Sneaky overlap",
        startAt,
        endAt,
        priority: 20,
        status: BookingStatus.CONFIRMED,
      },
    });

    // Now try to make it hold the same slot. The exclusion constraint fires.
    await expect(
      db.bookingOccupancy.create({
        data: { bookingId: orphan.id, subSpaceId: court.id, startAt, endAt },
      }),
    ).rejects.toThrow(/booking_occupancy_no_overlap|exclusion|conflicting key/i);

    expect(await db.bookingOccupancy.count({ where: { subSpaceId: court.id } })).toBe(
      await db.bookingOccupancy.count({ where: { bookingId: first.booking.id, subSpaceId: court.id } }),
    );
  });

  // Acceptance criterion 5.
  it("blocks Court A and Court B when the full floor is booked", async () => {
    const coachA = await userByEmail("bball.head@olsm.edu");
    const coachB = await userByEmail("gbball.head@olsm.edu");
    const fullFloor = await subSpace("dombrowski-fieldhouse", "full-floor");
    const courtA = await subSpace("dombrowski-fieldhouse", "court-a");
    const { startAt, endAt } = futureSlot(9, 120);

    await createBooking(
      {
        requesterId: coachA.id,
        subSpaceId: fullFloor.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Full floor practice",
        startAt,
        endAt,
      },
      actorFor(coachA),
    );

    await expect(
      createBooking(
        {
          requesterId: coachB.id,
          subSpaceId: courtA.id,
          activityType: ActivityType.TEAM_PRACTICE,
          title: "Court A practice",
          startAt,
          endAt,
        },
        actorFor(coachB),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets Court A and Court B run at the same time", async () => {
    const coachA = await userByEmail("bball.head@olsm.edu");
    const coachB = await userByEmail("gbball.head@olsm.edu");
    const courtA = await subSpace("dombrowski-fieldhouse", "court-a");
    const courtB = await subSpace("dombrowski-fieldhouse", "court-b");
    const { startAt, endAt } = futureSlot(10, 120);

    const a = await createBooking(
      {
        requesterId: coachA.id,
        subSpaceId: courtA.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Boys on Court A",
        startAt,
        endAt,
      },
      actorFor(coachA),
    );

    const b = await createBooking(
      {
        requesterId: coachB.id,
        subSpaceId: courtB.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Girls on Court B",
        startAt,
        endAt,
      },
      actorFor(coachB),
    );

    expect(a.status).toBe(BookingStatus.CONFIRMED);
    expect(b.status).toBe(BookingStatus.CONFIRMED);
  });

  it("allows back-to-back bookings once the buffer has elapsed", async () => {
    const coachA = await userByEmail("bball.head@olsm.edu");
    const coachB = await userByEmail("gbball.head@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "auxiliary");
    const { startAt, endAt } = futureSlot(11, 60);

    await createBooking(
      {
        requesterId: coachA.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "First",
        startAt,
        endAt,
      },
      actorFor(coachA),
    );

    // Rakoczy has a 15-minute buffer, so the next booking must start 30+
    // minutes later (15 of teardown plus 15 of setup).
    const second = await createBooking(
      {
        requesterId: coachB.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Second",
        startAt: new Date(endAt.getTime() + 31 * 60_000),
        endAt: new Date(endAt.getTime() + 91 * 60_000),
      },
      actorFor(coachB),
    );

    expect(second.status).toBe(BookingStatus.CONFIRMED);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 12: append-only audit log
// ---------------------------------------------------------------------------

describe("audit log", () => {
  it("records every state change", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "court-1");
    const { startAt, endAt } = futureSlot(0, 60);

    const result = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Practice",
        startAt,
        endAt,
      },
      actorFor(coach),
    );

    const entries = await db.auditLog.findMany({
      where: { entityType: "booking", entityId: result.booking.id },
      orderBy: { createdAt: "asc" },
    });

    expect(entries.map((e) => e.action)).toContain("booking.created");
    expect(entries.map((e) => e.action)).toContain("booking.status_changed");
    const transition = entries.find((e) => e.action === "booking.status_changed")!;
    expect(transition.fromState).toBe(BookingStatus.DRAFT);
    expect(transition.toState).toBe(BookingStatus.CONFIRMED);
    expect(transition.actorId).toBe(coach.id);
  });

  it("cannot be updated or deleted by any role", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const entry = await db.auditLog.create({
      data: { entityType: "booking", entityId: "x", action: "test", actorId: coach.id },
    });

    await expect(
      db.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/i);

    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/i);

    // And it is still there, unchanged.
    const after = await db.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.action).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// Soft locks
// ---------------------------------------------------------------------------

describe("soft locks", () => {
  it("releases an expired hold and returns the slot to open inventory", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const other = await userByEmail("gbball.head@olsm.edu");
    const court = await subSpace("dombrowski-fieldhouse", "turf");
    const { startAt, endAt } = futureSlot(1, 60);

    const pending = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.PRIVATE_INSTRUCTION,
        title: "Lessons awaiting paperwork",
        startAt,
        endAt,
      },
      actorFor(coach),
    );
    expect(pending.status).toBe(BookingStatus.PENDING_APPROVAL);

    // Wind the hold back into the past.
    await db.booking.update({
      where: { id: pending.booking.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });

    const released = await releaseExpiredHolds();
    expect(released).toBe(1);

    const after = await db.booking.findUniqueOrThrow({ where: { id: pending.booking.id } });
    expect(after.status).toBe(BookingStatus.EXPIRED);
    expect(await db.bookingOccupancy.count({ where: { bookingId: pending.booking.id } })).toBe(0);

    // The slot is genuinely free again.
    const reused = await createBooking(
      {
        requesterId: other.id,
        subSpaceId: court.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Practice on the freed slot",
        startAt,
        endAt,
      },
      actorFor(other),
    );
    expect(reused.status).toBe(BookingStatus.CONFIRMED);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 10: cancellation inside the no-refund window
// ---------------------------------------------------------------------------

describe("cancellation and refunds", () => {
  it("issues no refund inside the no-refund window, and logs the decision", async () => {
    const external = await createExternalRequester("norefund@example.com");
    const admin = await userByEmail("ad@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "full-court");

    // Two days out: inside the seeded 3-day no-refund window.
    const startAt = new Date(Date.now() + 2 * 86_400_000);
    startAt.setUTCHours(20, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 2 * 3_600_000);

    const booking = await createExternalRental(external.id, court.id, startAt, endAt, admin);
    const invoice = await db.invoice.findFirstOrThrow({ where: { bookingId: booking.id } });
    await markInvoicePaid(invoice.id, actorFor(admin), { method: "test" });

    const result = await cancelBooking(booking.id, "Changed their mind", actorFor(admin));

    expect(result.refundCents).toBe(0);
    expect(result.refundRationale).toMatch(/no-refund window/);

    const log = await db.auditLog.findFirst({
      where: { entityType: "invoice", action: "invoice.refund_declined" },
    });
    expect(log).not.toBeNull();
    expect(log!.reason).toMatch(/no-refund window/);
  });

  it("refunds per policy outside the window, and logs it", async () => {
    const external = await createExternalRequester("refundme@example.com");
    const admin = await userByEmail("ad@olsm.edu");
    const court = await subSpace("dombrowski-fieldhouse", "full-floor");

    const startAt = new Date(Date.now() + 30 * 86_400_000);
    startAt.setUTCHours(20, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 2 * 3_600_000);

    const booking = await createExternalRental(external.id, court.id, startAt, endAt, admin);
    const invoice = await db.invoice.findFirstOrThrow({ where: { bookingId: booking.id } });
    await markInvoicePaid(invoice.id, actorFor(admin), { method: "test" });

    const result = await cancelBooking(booking.id, "Cancelled well in advance", actorFor(admin));

    expect(result.refundCents).toBe(invoice.totalCents);
    const refreshed = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(refreshed.refundedCents).toBe(invoice.totalCents);
    expect(refreshed.status).toBe("REFUNDED");

    const log = await db.auditLog.findFirst({
      where: { entityType: "invoice", action: "invoice.refunded" },
    });
    expect(log).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 7: a contest bumps a lower-priority rental
// ---------------------------------------------------------------------------

describe("bumping", () => {
  it("lets a varsity contest bump an external rental, refunding it automatically", async () => {
    const external = await createExternalRequester("bumped@example.com");
    const admin = await userByEmail("ad@olsm.edu");
    const coach = await userByEmail("bball.head@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "full-court");

    const startAt = new Date(Date.now() + 40 * 86_400_000);
    startAt.setUTCHours(20, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 2 * 3_600_000);

    const rental = await createExternalRental(external.id, court.id, startAt, endAt, admin);
    const invoice = await db.invoice.findFirstOrThrow({ where: { bookingId: rental.id } });
    await markInvoicePaid(invoice.id, actorFor(admin), { method: "test" });

    // A coach cannot bump on their own authority, even when they outrank.
    await expect(
      createBooking(
        {
          requesterId: coach.id,
          subSpaceId: court.id,
          activityType: ActivityType.CONTEST,
          title: "Varsity home game",
          startAt,
          endAt,
          teamLevel: TeamLevel.VARSITY,
        },
        actorFor(coach),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // The admin confirms the bump.
    const contest = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.CONTEST,
        title: "Varsity home game",
        startAt,
        endAt,
        teamLevel: TeamLevel.VARSITY,
        confirmBump: true,
      },
      actorFor(admin),
    );

    expect(contest.status).toBe(BookingStatus.CONFIRMED);
    expect(contest.bumped).toHaveLength(1);
    expect(contest.bumped[0].id).toBe(rental.id);

    const bumpedBooking = await db.booking.findUniqueOrThrow({ where: { id: rental.id } });
    expect(bumpedBooking.status).toBe(BookingStatus.CANCELLED);

    // Refunded in full despite being inside no window in particular: a bumped
    // party is always made whole.
    const refreshedInvoice = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(refreshedInvoice.refundedCents).toBe(invoice.totalCents);

    // Notified automatically.
    const notice = await db.jobQueue.findFirst({
      where: { kind: "notify.email", idempotencyKey: { startsWith: `notify:bumped:${rental.id}` } },
    });
    expect(notice).not.toBeNull();

    const auditEntry = await db.auditLog.findFirst({
      where: { entityId: rental.id, action: "booking.bumped" },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("refuses to let a rental bump a contest", async () => {
    const external = await createExternalRequester("cantbump@example.com");
    const admin = await userByEmail("ad@olsm.edu");
    const coach = await userByEmail("bball.head@olsm.edu");
    const court = await subSpace("dombrowski-fieldhouse", "full-floor");

    const startAt = new Date(Date.now() + 45 * 86_400_000);
    startAt.setUTCHours(20, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 2 * 3_600_000);

    await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.CONTEST,
        title: "Varsity game",
        startAt,
        endAt,
        teamLevel: TeamLevel.VARSITY,
      },
      actorFor(coach),
    );

    // Even an admin confirming the bump cannot push a rental over a contest.
    await expect(
      createBooking(
        {
          requesterId: external.id,
          subSpaceId: court.id,
          activityType: ActivityType.EXTERNAL_RENTAL,
          title: "Corporate event",
          startAt,
          endAt,
          confirmBump: true,
        },
        actorFor(admin),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createExternalRequester(email: string) {
  const org = await db.organization.findFirstOrThrow({ where: { name: "Lakeshore Athletics LLC" } });
  return db.user.upsert({
    where: { email },
    update: { organizationId: org.id },
    create: {
      name: `External ${email}`,
      email,
      role: Role.EXTERNAL,
      organizationId: org.id,
      emailVerifiedAt: new Date(),
    },
  });
}

/** An external rental, walked through approval and documents but not payment. */
async function createExternalRental(
  requesterId: string,
  subSpaceId: string,
  startAt: Date,
  endAt: Date,
  admin: { id: string; name: string; role: Role },
) {
  const result = await createBooking(
    {
      requesterId,
      subSpaceId,
      activityType: ActivityType.EXTERNAL_RENTAL,
      title: "Outside rental",
      startAt,
      endAt,
      overrideAvailability: true,
    },
    actorFor(admin),
  );

  const step = await db.approvalStep.findFirstOrThrow({ where: { bookingId: result.booking.id } });
  await decideApproval(step.id, "APPROVED", actorFor(admin));

  const docs = await db.document.findMany({ where: { bookingId: result.booking.id } });
  for (const doc of docs) {
    if (doc.type === DocumentType.CERTIFICATE_OF_INSURANCE) {
      await db.document.update({
        where: { id: doc.id },
        data: {
          status: DocumentStatus.UPLOADED,
          expiresAt: new Date(endAt.getTime() + 365 * 86_400_000),
        },
      });
    } else {
      await recordSignature(doc.id, { name: "External", email: "external@example.com" });
    }
  }

  await advanceBooking(result.booking.id, actorFor(admin));
  return result.booking;
}
