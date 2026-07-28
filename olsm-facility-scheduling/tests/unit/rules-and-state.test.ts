import { describe, expect, it } from "vitest";
import { ActivityType, BookingStatus, Role, TeamLevel, type Rule } from "@prisma/client";
import { gatesFromRule, selectRule } from "@/domain/rules-engine";
import { canTransition, nextStatus } from "@/domain/booking-state";
import { assessBump, computePriority } from "@/domain/priority";
import { computeRefund, bumpRefund } from "@/domain/cancellation";
import { checkAnnualAgreement, agreementExpiryFor } from "@/domain/compliance";

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: overrides.id ?? "r",
    activityType: ActivityType.TEAM_PRACTICE,
    requesterRole: null,
    requiresAdminApproval: false,
    requiresHeadCoachApproval: false,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
    autoApprove: false,
    notifyAdmin: false,
    priorityRank: 20,
    documentHoldHours: 72,
    paymentHoldHours: 120,
    refundFullDays: 14,
    refundPartialDays: 3,
    refundPartialPercent: 50,
    mhsaaComplianceFlag: false,
    notes: null,
    updatedAt: new Date(),
    ...overrides,
  } as Rule;
}

describe("rule selection", () => {
  const rules = [
    rule({ id: "practice-head", activityType: ActivityType.TEAM_PRACTICE, requesterRole: Role.HEAD_COACH, autoApprove: true }),
    rule({ id: "practice-assistant", activityType: ActivityType.TEAM_PRACTICE, requesterRole: Role.ASSISTANT_COACH, requiresHeadCoachApproval: true }),
    rule({ id: "practice-generic", activityType: ActivityType.TEAM_PRACTICE, requesterRole: null, requiresAdminApproval: true }),
    rule({
      id: "private",
      activityType: ActivityType.PRIVATE_INSTRUCTION,
      requesterRole: null,
      requiresAdminApproval: true,
      requiresContract: true,
      requiresWaiver: true,
      requiresCoi: true,
      requiresPayment: true,
      priorityRank: 80,
    }),
  ];

  it("prefers the role-specific row", () => {
    const { rule: found, fallback } = selectRule(rules, ActivityType.TEAM_PRACTICE, Role.HEAD_COACH);
    expect(found.id).toBe("practice-head");
    expect(fallback).toBe(false);
  });

  it("falls back to the generic row", () => {
    const { rule: found, fallback } = selectRule(rules, ActivityType.TEAM_PRACTICE, Role.TRAINER);
    expect(found.id).toBe("practice-generic");
    expect(fallback).toBe(true);
  });

  /**
   * The central design claim: activity type is matched before role, so a head
   * coach running paid lessons does not get their auto-approve.
   */
  it("does not let a head coach escape the private-instruction gates", () => {
    const { rule: found } = selectRule(rules, ActivityType.PRIVATE_INSTRUCTION, Role.HEAD_COACH);
    expect(found.id).toBe("private");
    const gates = gatesFromRule(found);
    expect(gates).toMatchObject({
      requiresAdminApproval: true,
      requiresContract: true,
      requiresWaiver: true,
      requiresCoi: true,
      requiresPayment: true,
    });
  });

  it("explains itself when no rule is configured", () => {
    expect(() => selectRule(rules, ActivityType.EXTERNAL_RENTAL, Role.EXTERNAL)).toThrow(
      /No rule configured for activity type EXTERNAL_RENTAL/,
    );
  });
});

describe("state machine", () => {
  const noGates = {
    requiresAdminApproval: false,
    requiresHeadCoachApproval: false,
    requiresContract: false,
    requiresWaiver: false,
    requiresCoi: false,
    requiresPayment: false,
  };
  const cleared = { approvalsCleared: true, documentsCleared: true, paymentCleared: true };

  it("sends an ungated booking straight to CONFIRMED", () => {
    expect(nextStatus(noGates, cleared)).toBe(BookingStatus.CONFIRMED);
  });

  it("holds at approval first", () => {
    expect(
      nextStatus(
        { ...noGates, requiresAdminApproval: true, requiresContract: true, requiresPayment: true },
        { approvalsCleared: false, documentsCleared: false, paymentCleared: false },
      ),
    ).toBe(BookingStatus.PENDING_APPROVAL);
  });

  it("then documents, then payment", () => {
    const gates = { ...noGates, requiresAdminApproval: true, requiresContract: true, requiresPayment: true };
    expect(nextStatus(gates, { approvalsCleared: true, documentsCleared: false, paymentCleared: false })).toBe(
      BookingStatus.AWAITING_DOCUMENTS,
    );
    expect(nextStatus(gates, { approvalsCleared: true, documentsCleared: true, paymentCleared: false })).toBe(
      BookingStatus.AWAITING_PAYMENT,
    );
    expect(nextStatus(gates, cleared)).toBe(BookingStatus.CONFIRMED);
  });

  it("refuses illegal transitions", () => {
    expect(canTransition(BookingStatus.CANCELLED, BookingStatus.CONFIRMED)).toBe(false);
    expect(canTransition(BookingStatus.COMPLETED, BookingStatus.CONFIRMED)).toBe(false);
    expect(canTransition(BookingStatus.DRAFT, BookingStatus.CONFIRMED)).toBe(true);
  });
});

describe("priority and bumping", () => {
  const contest = rule({ activityType: ActivityType.CONTEST, priorityRank: 10 });
  const practice = rule({ activityType: ActivityType.TEAM_PRACTICE, priorityRank: 20 });
  const rental = rule({ activityType: ActivityType.EXTERNAL_RENTAL, priorityRank: 90 });

  it("ranks varsity practice above JV practice", () => {
    expect(computePriority(practice, TeamLevel.VARSITY)).toBeLessThan(
      computePriority(practice, TeamLevel.JV),
    );
  });

  it("keeps JV practice above every non-team activity", () => {
    expect(computePriority(practice, TeamLevel.FRESHMAN)).toBeLessThan(
      computePriority(rental, TeamLevel.NONE),
    );
  });

  // Acceptance criterion 7.
  it("lets a contest bump an external rental", () => {
    const assessment = assessBump(computePriority(contest, TeamLevel.VARSITY), [
      {
        id: "b1",
        reference: "OLSM-1",
        title: "Corporate 5-a-side",
        priority: computePriority(rental, TeamLevel.NONE),
        status: BookingStatus.CONFIRMED,
        startAt: new Date(),
        endAt: new Date(),
        requesterName: "Acme",
        requesterEmail: "a@example.com",
        paidAmountCents: 40000,
      },
    ]);
    expect(assessment.canProceed).toBe(true);
    expect(assessment.bumpable).toHaveLength(1);
    expect(assessment.blocking).toHaveLength(0);
  });

  it("will not let a rental bump a contest", () => {
    const assessment = assessBump(computePriority(rental, TeamLevel.NONE), [
      {
        id: "b2",
        reference: "OLSM-2",
        title: "Varsity game",
        priority: computePriority(contest, TeamLevel.VARSITY),
        status: BookingStatus.CONFIRMED,
        startAt: new Date(),
        endAt: new Date(),
        requesterName: "Coach",
        requesterEmail: "c@olsm.edu",
      },
    ]);
    expect(assessment.canProceed).toBe(false);
    expect(assessment.blocking).toHaveLength(1);
  });
});

describe("refund policy", () => {
  const policy = { refundFullDays: 14, refundPartialDays: 3, refundPartialPercent: 50 };
  const start = new Date("2026-06-01T18:00:00Z");

  it("refunds in full outside the full-refund window", () => {
    const out = computeRefund(40000, start, policy, new Date("2026-05-10T18:00:00Z"));
    expect(out.refundCents).toBe(40000);
    expect(out.percent).toBe(100);
  });

  it("refunds half inside the partial window", () => {
    const out = computeRefund(40000, start, policy, new Date("2026-05-25T18:00:00Z"));
    expect(out.refundCents).toBe(20000);
  });

  // Acceptance criterion 10.
  it("refunds nothing inside the no-refund window", () => {
    const out = computeRefund(40000, start, policy, new Date("2026-05-31T18:00:00Z"));
    expect(out.refundCents).toBe(0);
    expect(out.rationale).toMatch(/no-refund window/);
  });

  it("makes a bumped party whole regardless of the window", () => {
    expect(bumpRefund(40000).refundCents).toBe(40000);
  });
});

describe("annual coach agreement", () => {
  const signed = {
    type: "ANNUAL_COACH_AGREEMENT" as const,
    status: "SIGNED" as const,
    signedAt: new Date("2026-08-15T00:00:00Z"),
    expiresAt: new Date("2027-07-31T23:59:59Z"),
  };

  it("passes a coach with a current signed agreement", () => {
    expect(checkAnnualAgreement(Role.HEAD_COACH, [signed], new Date("2026-11-01T00:00:00Z")).ok).toBe(true);
  });

  // Acceptance criterion 3.
  it("blocks a coach with no agreement", () => {
    const check = checkAnnualAgreement(Role.HEAD_COACH, []);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("MISSING");
  });

  it("blocks a coach whose agreement expired", () => {
    const check = checkAnnualAgreement(Role.HEAD_COACH, [signed], new Date("2027-09-01T00:00:00Z"));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("EXPIRED");
  });

  it("blocks a coach whose agreement was sent but never signed", () => {
    const check = checkAnnualAgreement(Role.HEAD_COACH, [
      { ...signed, status: "SENT" as const, signedAt: null },
    ]);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("UNSIGNED");
  });

  it("does not require one of an external requester", () => {
    expect(checkAnnualAgreement(Role.EXTERNAL, []).ok).toBe(true);
  });

  it("expires an agreement at the end of the school year it was signed in", () => {
    // Signed in September 2026 -> covers the 2026-27 year, expires 31 Jul 2027.
    expect(agreementExpiryFor(new Date("2026-09-15T00:00:00Z")).toISOString()).toMatch(/^2027-07-31/);
    // Signed in June 2027 -> still the 2026-27 year, expires 31 Jul 2027.
    expect(agreementExpiryFor(new Date("2027-06-15T00:00:00Z")).toISOString()).toMatch(/^2027-07-31/);
  });
});
