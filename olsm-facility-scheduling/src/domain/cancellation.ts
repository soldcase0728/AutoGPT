/**
 * Cancellation and refund policy.
 *
 * Windows are per activity type and live on the `rules` row, so the AD edits
 * them in the admin UI. Seeded default (confirm before launch, see
 * DECISIONS.md): full refund 14+ days out, 50% from 3 to 13 days, none inside
 * 72 hours.
 */

export interface RefundPolicy {
  refundFullDays: number;
  refundPartialDays: number;
  refundPartialPercent: number;
}

export interface RefundOutcome {
  refundCents: number;
  percent: number;
  /** Human-readable justification, written into the audit log. */
  rationale: string;
  daysBeforeStart: number;
}

export function computeRefund(
  paidCents: number,
  startAt: Date,
  policy: RefundPolicy,
  now: Date = new Date(),
): RefundOutcome {
  const msUntilStart = startAt.getTime() - now.getTime();
  const daysBeforeStart = msUntilStart / 86_400_000;

  if (paidCents <= 0) {
    return {
      refundCents: 0,
      percent: 0,
      rationale: "No payment was captured for this booking.",
      daysBeforeStart,
    };
  }

  if (daysBeforeStart >= policy.refundFullDays) {
    return {
      refundCents: paidCents,
      percent: 100,
      rationale: `Cancelled ${fmtDays(daysBeforeStart)} before start, at or beyond the ${policy.refundFullDays}-day full-refund window.`,
      daysBeforeStart,
    };
  }

  if (daysBeforeStart >= policy.refundPartialDays) {
    const refundCents = Math.round((paidCents * policy.refundPartialPercent) / 100);
    return {
      refundCents,
      percent: policy.refundPartialPercent,
      rationale: `Cancelled ${fmtDays(daysBeforeStart)} before start, inside the ${policy.refundFullDays}-day window but at or beyond ${policy.refundPartialDays} days: ${policy.refundPartialPercent}% refund.`,
      daysBeforeStart,
    };
  }

  return {
    refundCents: 0,
    percent: 0,
    rationale: `Cancelled ${fmtDays(daysBeforeStart)} before start, inside the ${policy.refundPartialDays}-day no-refund window.`,
    daysBeforeStart,
  };
}

/**
 * A booking bumped by a higher-priority request is always made whole,
 * regardless of the cancellation window -- the party being bumped did nothing
 * wrong. This is deliberately not `computeRefund`.
 */
export function bumpRefund(paidCents: number): RefundOutcome {
  return {
    refundCents: paidCents,
    percent: paidCents > 0 ? 100 : 0,
    rationale: "Bumped by a higher-priority booking; refunded in full per policy.",
    daysBeforeStart: 0,
  };
}

export function describePolicy(policy: RefundPolicy): string {
  return (
    `Full refund ${policy.refundFullDays}+ days before the booking, ` +
    `${policy.refundPartialPercent}% from ${policy.refundPartialDays} to ${policy.refundFullDays - 1} days, ` +
    `no refund inside ${policy.refundPartialDays} days.`
  );
}

function fmtDays(days: number): string {
  if (days < 0) return "after the start time";
  if (days < 1) return `${Math.round(days * 24)} hours`;
  return `${Math.floor(days)} days`;
}
