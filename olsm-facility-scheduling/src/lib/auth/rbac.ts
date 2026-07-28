/**
 * Role capabilities.
 *
 * Role assignment is always admin-controlled; nothing here lets a user pick
 * their own role. External requesters self-register and are pinned to EXTERNAL.
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
