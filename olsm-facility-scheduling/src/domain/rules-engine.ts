/**
 * Rules engine.
 *
 * The approval matrix lives in the `rules` table, not here. This module only
 * knows how to *select* the applicable row and how to turn it into gates.
 *
 * Selection is (activityType, requesterRole) with a fallback to
 * (activityType, null). That ordering is the whole point of the design: a head
 * coach running a paid Saturday skills clinic is matched on
 * PRIVATE_INSTRUCTION first, so their role never buys them a way past the
 * contract, waiver, COI and payment gates. Activity type first, role second.
 *
 * Adding a new activity type is a row in `rules` plus a value in the
 * ActivityType enum -- no logic changes here.
 */

import { ActivityType, Role, type Rule } from "@prisma/client";
import type { GateFlags } from "./booking-state";

export interface RuleSelection {
  rule: Rule;
  /** True when the generic (role-agnostic) row was used. */
  fallback: boolean;
}

export function selectRule(
  rules: readonly Rule[],
  activityType: ActivityType,
  requesterRole: Role,
): RuleSelection {
  const forActivity = rules.filter((r) => r.activityType === activityType);
  const exact = forActivity.find((r) => r.requesterRole === requesterRole);
  if (exact) return { rule: exact, fallback: false };

  const generic = forActivity.find((r) => r.requesterRole === null);
  if (generic) return { rule: generic, fallback: true };

  throw new Error(
    `No rule configured for activity type ${activityType}. ` +
      `Add a row to the rules table (an admin can do this in Admin > Rules).`,
  );
}

export function gatesFromRule(rule: Rule): GateFlags {
  return {
    requiresAdminApproval: rule.requiresAdminApproval,
    requiresHeadCoachApproval: rule.requiresHeadCoachApproval,
    requiresContract: rule.requiresContract,
    requiresWaiver: rule.requiresWaiver,
    requiresCoi: rule.requiresCoi,
    requiresPayment: rule.requiresPayment,
  };
}

/**
 * A rule with autoApprove set clears the approval gate without an ApprovalStep.
 * Note this only clears *approval* -- an auto-approved rule that still requires
 * a contract and payment (there is no such row in the seeded matrix, but an
 * admin could create one) still waits on those.
 */
export function approvalsClearedAtCreation(rule: Rule): boolean {
  if (rule.autoApprove) return true;
  return !rule.requiresAdminApproval && !rule.requiresHeadCoachApproval;
}

/** Documents a booking must collect, derived from its gates. */
export function requiredDocumentTypes(gates: GateFlags, activityType: ActivityType) {
  const types: string[] = [];
  if (gates.requiresContract) {
    types.push(
      activityType === ActivityType.SCHOOL_CAMP ? "CAMP_ADDENDUM" : "FACILITY_USE_AGREEMENT",
    );
  }
  if (gates.requiresWaiver) types.push("LIABILITY_WAIVER");
  if (gates.requiresCoi) types.push("CERTIFICATE_OF_INSURANCE");
  return types;
}

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  CONTEST: "Contest / game / meet",
  TEAM_PRACTICE: "In-season team practice",
  TEAM_OFFSEASON: "Out-of-season / open gym / conditioning",
  SCHOOL_CAMP: "School-sanctioned camp or clinic",
  PRIVATE_INSTRUCTION: "Private lessons / personal training",
  CLUB_TRAVEL: "Club / travel / AAU team use",
  SCHOOL_EVENT: "Non-athletic school event",
  EXTERNAL_RENTAL: "Third-party rental",
  MAINTENANCE: "Maintenance / blackout",
};

export const ACTIVITY_DESCRIPTIONS: Record<ActivityType, string> = {
  CONTEST: "Scheduled interscholastic competition.",
  TEAM_PRACTICE: "Official OLSM team, inside its MHSAA-defined season.",
  TEAM_OFFSEASON: "OLSM team members, outside the season.",
  SCHOOL_CAMP: "OLSM-run, OLSM collects the revenue.",
  PRIVATE_INSTRUCTION:
    "Individual instruction where the coach or a third party is paid directly. " +
    "This applies to OLSM staff too.",
  CLUB_TRAVEL: "Non-OLSM team, may include OLSM students.",
  SCHOOL_EVENT: "Mass, assembly, admissions event, banquet, alumni event.",
  EXTERNAL_RENTAL: "Outside organization with no OLSM affiliation.",
  MAINTENANCE: "Admin only. Blocks the space.",
};

/** Activity types an external requester may choose in the public wizard. */
export const EXTERNAL_ACTIVITY_TYPES: readonly ActivityType[] = [
  ActivityType.EXTERNAL_RENTAL,
  ActivityType.CLUB_TRAVEL,
  ActivityType.PRIVATE_INSTRUCTION,
];

/** Activity types only an admin may create. */
export const ADMIN_ONLY_ACTIVITY_TYPES: readonly ActivityType[] = [ActivityType.MAINTENANCE];
