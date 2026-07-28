/**
 * Rate cards and invoice construction.
 *
 * Rate lookup is facility x activity_type x rate_tier, effective-dated. All
 * money is integer cents; nothing here uses floats for currency.
 */

import { ActivityType, RateTier, type RateCard } from "@prisma/client";
import { hoursBetween } from "@/lib/time";

export interface LineItem {
  label: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
  kind: "facility" | "surcharge" | "deposit" | "discount";
}

export interface SurchargeSpec {
  code: string;
  label: string;
  kind: "flat" | "hourly";
  amountCents: number;
}

export interface QuoteInput {
  rateCards: readonly RateCard[];
  facilityId: string;
  activityType: ActivityType;
  rateTier: RateTier;
  startAt: Date;
  endAt: Date;
  surcharges?: readonly SurchargeSpec[];
  /** Overrides the rate card's deposit, e.g. an admin waiving it. */
  depositCentsOverride?: number | null;
  at?: Date;
}

export interface Quote {
  lineItems: LineItem[];
  subtotalCents: number;
  depositCents: number;
  totalCents: number;
  billedHours: number;
  rateCardId: string | null;
  /** True when no rate card matched; the booking is free by configuration. */
  unpriced: boolean;
}

export function findRateCard(
  rateCards: readonly RateCard[],
  facilityId: string,
  activityType: ActivityType,
  rateTier: RateTier,
  at: Date = new Date(),
): RateCard | null {
  const matches = rateCards.filter(
    (rc) =>
      rc.facilityId === facilityId &&
      rc.activityType === activityType &&
      rc.rateTier === rateTier &&
      rc.effectiveFrom <= at &&
      (rc.effectiveTo === null || rc.effectiveTo > at),
  );
  if (matches.length === 0) return null;
  // Most recently effective wins when an admin has stacked overlapping cards.
  return matches.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}

export function quote(input: QuoteInput): Quote {
  const at = input.at ?? new Date();
  const card = findRateCard(
    input.rateCards,
    input.facilityId,
    input.activityType,
    input.rateTier,
    at,
  );

  const rawHours = hoursBetween(input.startAt, input.endAt);
  const lineItems: LineItem[] = [];

  if (!card) {
    return {
      lineItems,
      subtotalCents: 0,
      depositCents: 0,
      totalCents: 0,
      billedHours: rawHours,
      rateCardId: null,
      unpriced: true,
    };
  }

  const billedHours = Math.max(rawHours, card.minHours);

  // A flat day rate caps the hourly charge rather than replacing it, so a
  // six-hour rental is never billed more than a full-day rental.
  const hourlyTotal = Math.round(card.hourlyCents * billedHours);
  const useFlat = card.flatDayCents !== null && hourlyTotal > card.flatDayCents;

  if (useFlat) {
    lineItems.push({
      label: "Facility rental (full day)",
      quantity: 1,
      unitAmountCents: card.flatDayCents!,
      amountCents: card.flatDayCents!,
      kind: "facility",
    });
  } else if (card.hourlyCents > 0) {
    lineItems.push({
      label: `Facility rental (${formatHours(billedHours)} @ ${formatMoney(card.hourlyCents)}/hr)`,
      quantity: billedHours,
      unitAmountCents: card.hourlyCents,
      amountCents: hourlyTotal,
      kind: "facility",
    });
  }

  for (const s of input.surcharges ?? []) {
    const amount =
      s.kind === "hourly" ? Math.round(s.amountCents * billedHours) : s.amountCents;
    if (amount === 0) continue;
    lineItems.push({
      label: s.label,
      quantity: s.kind === "hourly" ? billedHours : 1,
      unitAmountCents: s.amountCents,
      amountCents: amount,
      kind: "surcharge",
    });
  }

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.amountCents, 0);
  const depositCents = input.depositCentsOverride ?? card.depositCents;

  if (depositCents > 0) {
    lineItems.push({
      label: "Refundable security deposit (authorised, not captured)",
      quantity: 1,
      unitAmountCents: depositCents,
      amountCents: depositCents,
      kind: "deposit",
    });
  }

  return {
    lineItems,
    subtotalCents,
    depositCents,
    // The deposit is authorised separately, so it is not part of the charge.
    totalCents: subtotalCents,
    billedHours,
    rateCardId: card.id,
    unpriced: false,
  };
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
}

/**
 * Which rate tier a booking is billed at.
 *
 * The requester's organisation is the usual answer, but not for paid personal
 * use of school property. A head coach belongs to the INTERNAL organisation and
 * would otherwise be billed $0 for the Saturday skills clinic they charge
 * families for -- which is exactly the leakage this system exists to close. For
 * PRIVATE_INSTRUCTION and EXTERNAL_RENTAL the internal tier is never available;
 * the requester is acting as an outside business and is billed as one.
 */
export function resolveRateTier(
  activityType: ActivityType,
  organizationTier: RateTier | null | undefined,
): RateTier {
  const tier = organizationTier ?? RateTier.COMMERCIAL;

  const neverInternal: ActivityType[] = [
    ActivityType.PRIVATE_INSTRUCTION,
    ActivityType.EXTERNAL_RENTAL,
  ];

  if (neverInternal.includes(activityType) && tier === RateTier.INTERNAL) {
    return RateTier.COMMERCIAL;
  }

  return tier;
}

export const RATE_TIER_LABELS: Record<RateTier, string> = {
  INTERNAL: "Internal (OLSM)",
  OLSM_AFFILIATED_CLUB: "OLSM-affiliated club",
  PARISH_PARTNER: "Parish / partner",
  NONPROFIT: "Non-profit",
  COMMERCIAL: "Commercial",
};
