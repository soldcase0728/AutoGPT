/**
 * Participant waivers, security deposits and weather cancellation, against a
 * real database.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ActivityType, BookingStatus, DocumentStatus, DocumentType, Role } from "@prisma/client";
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
import { advanceBooking, createBooking, decideApproval } from "@/services/booking-service";
import { markInvoicePaid } from "@/services/invoice-service";
import { recordSignature } from "@/services/document-service";
import {
  addRoster,
  bookingsMissingWaivers,
  ensureWaiverToken,
  rosterStatus,
  selfRegisterParticipant,
} from "@/services/participant-service";
import {
  captureHeldDeposit,
  depositStatus,
  depositsAwaitingResolution,
  releaseHeldDeposit,
} from "@/services/deposit-service";
import { cancelForWeather, previewWeatherImpact } from "@/services/weather-service";
import { ValidationError } from "@/lib/errors";
import { instantToLocalDate } from "@/lib/time";

beforeAll(() => {
  ensureMigrated();
});

beforeEach(async () => {
  await resetTransactionalData();
  await db.document.deleteMany({});
  await reseedAgreements();
});

// ---------------------------------------------------------------------------
// Participant waivers
// ---------------------------------------------------------------------------

describe("participant waivers", () => {
  async function clinicBooking(slot = 1) {
    const coach = await userByEmail("bball.head@olsm.edu");
    const court = await subSpace("rakoczy-gymnasium", "court-1");
    const { startAt, endAt } = futureSlot(slot, 120);

    const result = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.PRIVATE_INSTRUCTION,
        title: "Skills clinic",
        startAt,
        endAt,
        headcount: 3,
      },
      actorFor(coach),
    );
    return { booking: result.booking, coach };
  }

  it("collects a signature per participant, not just from the organizer", async () => {
    const { booking, coach } = await clinicBooking(1);

    await addRoster(
      booking.id,
      [
        { name: "Alice Adams", email: "alice@example.com", isMinor: false },
        { name: "Sam Smith", isMinor: true, guardianName: "Jane Smith", guardianEmail: "jane@example.com" },
      ],
      actorFor(coach),
    );

    const status = await rosterStatus(booking.id);
    expect(status.onRoster).toBe(2);
    expect(status.signed).toBe(0);
    expect(status.complete).toBe(false);
    // Headcount says three; only two are on the roster.
    expect(status.shortOfHeadcount).toBe(true);

    // The minor's document is the minor type and carries the guardian.
    const minor = await db.document.findFirstOrThrow({
      where: { bookingId: booking.id, isMinor: true },
    });
    expect(minor.type).toBe(DocumentType.MINOR_PARTICIPANT_WAIVER);
    expect(minor.guardianName).toBe("Jane Smith");

    // Each participant was emailed their own link; the minor's went to the
    // guardian, not the child.
    const emails = await db.jobQueue.findMany({
      where: { kind: "notify.email", idempotencyKey: { startsWith: `participant-waiver:${booking.id}` } },
    });
    expect(emails).toHaveLength(2);
    const recipients = emails.map((e) => (e.payload as { to: string }).to).sort();
    expect(recipients).toEqual(["alice@example.com", "jane@example.com"]);
  });

  it("lets a participant sign themselves through the shared link", async () => {
    const { booking, coach } = await clinicBooking(2);
    const token = await ensureWaiverToken(booking.id, actorFor(coach));

    await selfRegisterParticipant(
      token,
      { name: "Walk-in Wendy", email: "wendy@example.com", isMinor: false },
      "203.0.113.9",
    );

    const status = await rosterStatus(booking.id);
    expect(status.onRoster).toBe(1);
    expect(status.signed).toBe(1);
    expect(status.complete).toBe(true);

    // The signature is evidence, so it records who, when and from where.
    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: "waiver.participant_signed" },
    });
    expect(entry.ipAddress).toBe("203.0.113.9");
    expect(entry.actorLabel).toBe("Walk-in Wendy");
  });

  it("records a guardian as the signer for a minor", async () => {
    const { booking, coach } = await clinicBooking(3);
    const token = await ensureWaiverToken(booking.id, actorFor(coach));

    await selfRegisterParticipant(
      token,
      { name: "Sam Smith", isMinor: true, guardianName: "Jane Smith", guardianEmail: "jane@example.com" },
      null,
    );

    const doc = await db.document.findFirstOrThrow({ where: { bookingId: booking.id, isParticipant: true } });
    expect(doc.status).toBe(DocumentStatus.SIGNED);
    expect(doc.guardianName).toBe("Jane Smith");

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: "waiver.participant_signed" },
    });
    expect(entry.actorLabel).toBe("Jane Smith (for Sam Smith)");
  });

  it("refuses a minor with no guardian named", async () => {
    const { booking, coach } = await clinicBooking(4);
    const token = await ensureWaiverToken(booking.id, actorFor(coach));

    await expect(
      selfRegisterParticipant(token, { name: "Sam Smith", isMinor: true }, null),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("treats a second signature from the same person as a duplicate", async () => {
    const { booking, coach } = await clinicBooking(5);
    const token = await ensureWaiverToken(booking.id, actorFor(coach));

    const entry = { name: "Alice Adams", email: "alice@example.com", isMinor: false };
    await selfRegisterParticipant(token, entry, null);
    await selfRegisterParticipant(token, entry, null);

    const status = await rosterStatus(booking.id);
    expect(status.onRoster).toBe(1);
  });

  it("will not take a waiver after the activity has finished", async () => {
    const { booking, coach } = await clinicBooking(6);
    const token = await ensureWaiverToken(booking.id, actorFor(coach));

    await db.booking.update({
      where: { id: booking.id },
      data: {
        startAt: new Date(Date.now() - 4 * 3_600_000),
        endAt: new Date(Date.now() - 2 * 3_600_000),
      },
    });

    await expect(
      selfRegisterParticipant(token, { name: "Late Larry", isMinor: false }, null),
    ).rejects.toThrow(/already finished/i);
  });

  /**
   * Participant waivers deliberately do NOT block CONFIRMED -- a camp confirms
   * months before its roster exists. They are chased before the event instead.
   */
  it("does not hold up confirmation, but is chased before the event", async () => {
    const coach = await userByEmail("bball.head@olsm.edu");
    const admin = await userByEmail("ad@olsm.edu");
    const court = await subSpace("dombrowski-fieldhouse", "court-a");
    const startAt = new Date(Date.now() + 36 * 3_600_000);
    const endAt = new Date(startAt.getTime() + 2 * 3_600_000);

    const result = await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: court.id,
        activityType: ActivityType.PRIVATE_INSTRUCTION,
        title: "Clinic with an empty roster",
        startAt,
        endAt,
        headcount: 10,
        overrideAvailability: true,
      },
      actorFor(admin),
    );

    // Clear every gate that does block confirmation.
    const step = await db.approvalStep.findFirstOrThrow({ where: { bookingId: result.booking.id } });
    await decideApproval(step.id, "APPROVED", actorFor(admin));

    const docs = await db.document.findMany({
      where: { bookingId: result.booking.id, isParticipant: false },
    });
    for (const doc of docs) {
      if (doc.type === DocumentType.CERTIFICATE_OF_INSURANCE) {
        await db.document.update({
          where: { id: doc.id },
          data: {
            status: DocumentStatus.ACCEPTED,
            expiresAt: new Date(endAt.getTime() + 365 * 86_400_000),
          },
        });
      } else {
        await recordSignature(doc.id, { name: coach.name, email: coach.email });
      }
    }
    const invoice = await db.invoice.findFirstOrThrow({ where: { bookingId: result.booking.id } });
    await markInvoicePaid(invoice.id, actorFor(admin), { method: "test" });
    const advanced = await advanceBooking(result.booking.id, actorFor(admin));

    // Confirmed with nobody on the roster.
    expect(advanced.booking.status).toBe(BookingStatus.CONFIRMED);

    // But it shows up on the pre-event chase list.
    const missing = await bookingsMissingWaivers(72);
    expect(missing.map((m) => m.booking.id)).toContain(result.booking.id);
    expect(missing.find((m) => m.booking.id === result.booking.id)!.missing).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Security deposits
// ---------------------------------------------------------------------------

describe("security deposits", () => {
  async function rentalWithDeposit(slot: number) {
    const admin = await userByEmail("ad@olsm.edu");
    const org = await db.organization.findFirstOrThrow({ where: { name: "Lakeshore Athletics LLC" } });
    const renter = await db.user.upsert({
      where: { email: `deposit${slot}@example.com` },
      update: {},
      create: {
        name: "Deposit Renter",
        email: `deposit${slot}@example.com`,
        role: Role.EXTERNAL,
        organizationId: org.id,
      },
    });

    const court = await subSpace("rakoczy-gymnasium", "full-court");
    const { startAt, endAt } = futureSlot(slot, 120);

    const result = await createBooking(
      {
        requesterId: renter.id,
        subSpaceId: court.id,
        activityType: ActivityType.EXTERNAL_RENTAL,
        title: "Corporate rental",
        startAt,
        endAt,
      },
      actorFor(admin),
    );

    const invoice = await db.invoice.findFirstOrThrow({ where: { bookingId: result.booking.id } });
    // Stripe is not configured in tests, so stand in for the authorization.
    await db.invoice.update({
      where: { id: invoice.id },
      data: { depositIntentId: "pi_test_hold" },
    });

    return { bookingId: result.booking.id, invoiceId: invoice.id, admin };
  }

  it("prices a deposit onto an external rental", async () => {
    const { invoiceId } = await rentalWithDeposit(7);
    const status = await depositStatus(invoiceId);
    expect(status.amountCents).toBeGreaterThan(0);
    expect(status.state).toBe("held");
  });

  it("releases a hold without charging anything", async () => {
    const { invoiceId, admin } = await rentalWithDeposit(8);
    await releaseHeldDeposit(invoiceId, actorFor(admin));

    const status = await depositStatus(invoiceId);
    expect(status.state).toBe("released");
    expect(status.capturedCents).toBe(0);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "deposit.released" } });
    expect(entry.entityId).toBe(invoiceId);

    // The renter is told, because a hold sitting on their card is not obvious.
    const email = await db.jobQueue.findFirst({
      where: { idempotencyKey: `deposit-released:${invoiceId}` },
    });
    expect(email).not.toBeNull();
  });

  it("captures part of a hold with a recorded reason", async () => {
    const { invoiceId, admin } = await rentalWithDeposit(9);
    await captureHeldDeposit(invoiceId, 18000, "Two damaged wall pads; replacement quoted $180.", actorFor(admin));

    const status = await depositStatus(invoiceId);
    expect(status.state).toBe("captured");
    expect(status.capturedCents).toBe(18000);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "deposit.captured" } });
    expect(entry.reason).toMatch(/wall pads/);
  });

  it("will not capture more than was authorized", async () => {
    const { invoiceId, admin } = await rentalWithDeposit(10);
    const status = await depositStatus(invoiceId);

    await expect(
      captureHeldDeposit(invoiceId, status.amountCents + 1, "Trying to overcharge on purpose.", actorFor(admin)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("demands a specific reason before keeping anyone's money", async () => {
    const { invoiceId, admin } = await rentalWithDeposit(11);
    await expect(
      captureHeldDeposit(invoiceId, 5000, "damage", actorFor(admin)),
    ).rejects.toThrow(/specific reason/i);
  });

  it("refuses to resolve the same deposit twice", async () => {
    const { invoiceId, admin } = await rentalWithDeposit(0);
    await releaseHeldDeposit(invoiceId, actorFor(admin));
    await expect(releaseHeldDeposit(invoiceId, actorFor(admin))).rejects.toThrow(/already been resolved/i);
  });

  it("lists holds still open after the rental finished", async () => {
    const { invoiceId, bookingId } = await rentalWithDeposit(2);
    await db.booking.update({
      where: { id: bookingId },
      data: {
        startAt: new Date(Date.now() - 4 * 3_600_000),
        endAt: new Date(Date.now() - 2 * 3_600_000),
      },
    });

    const pending = await depositsAwaitingResolution();
    expect(pending.map((i) => i.id)).toContain(invoiceId);
  });
});

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

describe("weather cancellation", () => {
  it("clears a field for the day and refunds everyone in full", async () => {
    const admin = await userByEmail("ad@olsm.edu");
    const coach = await userByEmail("football.head@olsm.edu");
    const facility = await db.facility.findUniqueOrThrow({ where: { slug: "milewski-field" } });
    const north = await subSpace("milewski-field", "north");
    const south = await subSpace("milewski-field", "south");

    // Tomorrow: inside the seeded 3-day no-refund window on purpose.
    const { startAt, endAt, dateISO } = futureSlot(3, 120, 0);
    const soonStart = new Date(Date.now() + 26 * 3_600_000);
    const soonEnd = new Date(soonStart.getTime() + 2 * 3_600_000);
    const soonDateISO = instantToLocalDate(soonStart);

    // A team practice and a paid external rental on the same field.
    await createBooking(
      {
        requesterId: coach.id,
        subSpaceId: north.id,
        activityType: ActivityType.TEAM_PRACTICE,
        title: "Football practice",
        startAt: soonStart,
        endAt: soonEnd,
        overrideAvailability: true,
      },
      actorFor(admin),
    );

    const org = await db.organization.findFirstOrThrow({ where: { name: "Lakeshore Athletics LLC" } });
    const renter = await db.user.upsert({
      where: { email: "weather@example.com" },
      update: { smsOptIn: true, phone: "+15550100" },
      create: {
        name: "Weather Renter",
        email: "weather@example.com",
        role: Role.EXTERNAL,
        organizationId: org.id,
        phone: "+15550100",
        smsOptIn: true,
      },
    });

    const rental = await createBooking(
      {
        requesterId: renter.id,
        subSpaceId: south.id,
        activityType: ActivityType.EXTERNAL_RENTAL,
        title: "Corporate 5-a-side",
        startAt: soonStart,
        endAt: soonEnd,
        overrideAvailability: true,
      },
      actorFor(admin),
    );

    const invoice = await db.invoice.findFirstOrThrow({ where: { bookingId: rental.booking.id } });
    await markInvoicePaid(invoice.id, actorFor(admin), { method: "test" });

    const preview = await previewWeatherImpact(facility.id, soonDateISO);
    expect(preview).toHaveLength(2);
    expect(preview.some((p) => p.smsOptIn)).toBe(true);

    const result = await cancelForWeather(
      facility.id,
      soonDateISO,
      "Lightning in the area",
      actorFor(admin),
    );

    expect(result.cancelled).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(result.emailsSent).toBe(2);
    expect(result.smsSent).toBe(1);

    // Refunded in full despite being inside the no-refund window: the school
    // cancelled, not the renter.
    expect(result.refundedCents).toBe(invoice.totalCents);
    const refreshed = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(refreshed.refundedCents).toBe(invoice.totalCents);

    // Both bookings released their slots.
    const bookings = await db.booking.findMany({ where: { subSpace: { facilityId: facility.id } } });
    expect(bookings.every((b) => b.status === BookingStatus.CANCELLED)).toBe(true);
    expect(await db.bookingOccupancy.count({ where: { subSpaceId: north.id } })).toBe(0);

    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "weather.cancelled_day" } });
    expect(entry.reason).toBe("Lightning in the area");

    // Unused: proves the slot helper produced a distinct future day.
    expect(startAt < endAt).toBe(true);
    expect(dateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses a weather call with nothing booked", async () => {
    const admin = await userByEmail("ad@olsm.edu");
    const facility = await db.facility.findUniqueOrThrow({ where: { slug: "running-track" } });
    const { dateISO } = futureSlot(5, 60, 6);

    await expect(
      cancelForWeather(facility.id, dateISO, "Heavy rain", actorFor(admin)),
    ).rejects.toThrow(/Nothing is booked/i);
  });

  it("requires the conditions to be described", async () => {
    const admin = await userByEmail("ad@olsm.edu");
    const facility = await db.facility.findUniqueOrThrow({ where: { slug: "milewski-field" } });
    const { dateISO } = futureSlot(6, 60, 6);

    await expect(cancelForWeather(facility.id, dateISO, "rain", actorFor(admin))).rejects.toThrow(
      /Say what the conditions are/i,
    );
  });
});
