/**
 * Role capabilities.
 *
 * Role assignment is always admin-controlled; nothing here lets a user pick
 * their own role, and nobody can create an account that outranks their own.
 *
 * Note the split between `user:invite` and `user:manage`. Adding a person and
 * sending them a sign-in link is daily athletic-office work, so the athletic
 * office can do it. Changing somebody's role or switching an account off is how
 * authority moves around the system, so that stays with the director.
 */

import { ActivityType, Role } from "@prisma/client";

export type Permission =
  | "booking:create"
  | "booking:create-any-facility"
  | "booking:edit-any"
  | "booking:cancel-any"
  | "booking:override-conflict"
  | "booking:check-in"
  | "approval:decide"
  | "approval:decide-own-sport"
  | "facility:manage"
  | "facility:mark-unavailable"
  | "rules:manage"
  | "rates:manage"
  | "season:manage"
  | "user:invite"
  | "user:manage"
  | "invoice:view"
  | "invoice:refund"
  | "report:view"
  | "report:revenue"
  | "audit:view"
  | "calendar:view-all"
  | "setup-board:view";

const ADMIN_BASE: Permission[] = [
  "booking:create",
  "booking:create-any-facility",
  "booking:edit-any",
  "booking:cancel-any",
  "booking:override-conflict",
  "booking:check-in",
  "approval:decide",
  "approval:decide-own-sport",
  "facility:manage",
  "facility:mark-unavailable",
  "season:manage",
  "invoice:view",
  "invoice:refund",
  "report:view",
  "report:revenue",
  "audit:view",
  "calendar:view-all",
  "setup-board:view",
  "user:invite",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [...ADMIN_BASE, "rules:manage", "rates:manage", "user:manage"],
  FACILITY_ADMIN: ADMIN_BASE,
  HEAD_COACH: [
    "booking:create",
    "approval:decide-own-sport",
    "calendar:view-all",
    "booking:check-in",
  ],
  ASSISTANT_COACH: ["booking:create", "calendar:view-all"],
  TRAINER: ["booking:create", "calendar:view-all"],
  STRENGTH_COACH: ["booking:create", "calendar:view-all"],
  FACILITIES: ["calendar:view-all", "setup-board:view", "facility:mark-unavailable"],
  FINANCE: ["calendar:view-all", "invoice:view", "report:view", "report:revenue"],
  EXTERNAL: ["booking:create"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isAdmin(role: Role): boolean {
  return role === Role.SUPER_ADMIN || role === Role.FACILITY_ADMIN;
}

/**
 * How much authority each role carries.
 *
 * Used to pick the strongest of several claims on a sign-in token, and to stop
 * anybody creating an account that outranks their own. Not a permission check --
 * `can()` is still the authority on what a role may do. This only orders them.
 */
export const ROLE_RANK: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 70,
  [Role.FACILITY_ADMIN]: 60,
  [Role.HEAD_COACH]: 50,
  [Role.ASSISTANT_COACH]: 40,
  [Role.STRENGTH_COACH]: 30,
  [Role.TRAINER]: 30,
  [Role.FACILITIES]: 20,
  [Role.FINANCE]: 20,
  [Role.EXTERNAL]: 0,
};

/**
 * Roles this user may hand out.
 *
 * Equal rank is allowed -- one director appoints another -- but nothing above
 * it, so the athletic office cannot mint a director and a director cannot be
 * bootstrapped into existence from below. EXTERNAL is always offerable: setting
 * up an outside group is the ordinary case, and it carries no authority.
 */
export function assignableRoles(actorRole: Role): Role[] {
  return Object.values(Role).filter(
    (role) => role === Role.EXTERNAL || ROLE_RANK[role] <= ROLE_RANK[actorRole],
  );
}

export function canAssignRole(actorRole: Role, target: Role): boolean {
  return assignableRoles(actorRole).includes(target);
}

export function isInternal(role: Role): boolean {
  return role !== Role.EXTERNAL;
}

export interface ScopeContext {
  role: Role;
  /** Sub-space or facility ids this user is explicitly scoped to. */
  facilityScope: readonly string[];
}

/**
 * Trainers and strength coaches are scoped to specific facilities. An empty
 * scope means the role default: admins get everything, internal staff get every
 * internally-bookable facility, externals get only externally-bookable ones.
 */
export function canBookFacility(
  ctx: ScopeContext,
  facility: { id: string; externallyBookable: boolean },
): boolean {
  if (isAdmin(ctx.role)) return true;

  if (ctx.role === Role.EXTERNAL) return facility.externallyBookable;

  if (ctx.facilityScope.length > 0) return ctx.facilityScope.includes(facility.id);

  return true;
}

/** Activity types a role may request directly. */
export function allowedActivityTypes(role: Role): ActivityType[] {
  if (isAdmin(role)) return Object.values(ActivityType);

  if (role === Role.EXTERNAL) {
    return [
      ActivityType.EXTERNAL_RENTAL,
      ActivityType.CLUB_TRAVEL,
      ActivityType.PRIVATE_INSTRUCTION,
    ];
  }

  if (role === Role.FACILITIES || role === Role.FINANCE) return [];

  // Internal staff: everything except admin-only MAINTENANCE.
  return Object.values(ActivityType).filter((a) => a !== ActivityType.MAINTENANCE);
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Athletic Director (super admin)",
  FACILITY_ADMIN: "Athletic office (facility admin)",
  HEAD_COACH: "Head coach",
  ASSISTANT_COACH: "Assistant / position coach",
  TRAINER: "Athletic trainer",
  STRENGTH_COACH: "Strength coach",
  FACILITIES: "Facilities / custodial",
  FINANCE: "Business office / finance",
  EXTERNAL: "External requester",
};
