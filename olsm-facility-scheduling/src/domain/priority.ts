/**
 * Priority and bumping.
 *
 * Ranking comes from `rules.priority_rank` (lower wins) so the AD can reorder
 * it without a deploy. The one thing not expressible as a single rank is
 * varsity outranking JV/freshman *within* TEAM_PRACTICE, so team level applies
 * a small tie-break offset on top of the rule's rank.
 *
 * Seeded order:
 *   CONTEST > TEAM_PRACTICE (varsity) > TEAM_PRACTICE (JV/frosh) > SCHOOL_EVENT
 *   > TEAM_OFFSEASON > SCHOOL_CAMP > CLUB_TRAVEL > PRIVATE_INSTRUCTION
 *   > EXTERNAL_RENTAL
 */

import { BookingStatus, TeamLevel, type Rule } from "@prisma/client";

/** Sub-ranks inside one activity type. Kept smaller than the gap between ranks. */
const TEAM_LEVEL_OFFSET: Record<TeamLevel, number> = {
  VARSITY: 0,
  JV: 1,
  FRESHMAN: 2,
  MIDDLE_SCHOOL: 3,
  NONE: 0,
};

export function computePriority(rule: Rule, teamLevel: TeamLevel = TeamLevel.NONE): number {
  return rule.priorityRank + TEAM_LEVEL_OFFSET[teamLevel];
}

export function outranks(candidate: number, incumbent: number): boolean {
  return candidate < incumbent;
}

export interface BumpCandidate {
  id: string;
  reference: string;
  title: string;
  priority: number;
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  requesterName: string;
  requesterEmail: string;
  /** Present when the bumped booking was paid and owes a refund. */
  paidInvoiceId?: string | null;
  paidAmountCents?: number;
}

export interface BumpAssessment {
  bumpable: BumpCandidate[];
  blocking: BumpCandidate[];
  /** True when every conflicting booking can be bumped by this request. */
  canProceed: boolean;
}

/**
 * Split the bookings occupying a slot into the ones this request outranks and
 * the ones it does not. A request that outranks everything can proceed (with
 * admin confirmation); anything left in `blocking` means the request is denied
 * or must move.
 */
export function assessBump(
  requestPriority: number,
  conflicts: readonly BumpCandidate[],
): BumpAssessment {
  const bumpable: BumpCandidate[] = [];
  const blocking: BumpCandidate[] = [];

  for (const c of conflicts) {
    if (outranks(requestPriority, c.priority)) bumpable.push(c);
    else blocking.push(c);
  }

  return { bumpable, blocking, canProceed: blocking.length === 0 && conflicts.length > 0 };
}

export function priorityLabel(priority: number): string {
  if (priority <= 10) return "Highest";
  if (priority <= 30) return "High";
  if (priority <= 60) return "Normal";
  return "Low";
}
