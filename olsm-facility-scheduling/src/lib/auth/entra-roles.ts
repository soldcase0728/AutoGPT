import { Role } from "@prisma/client";
import { env } from "../env";
import { ROLE_RANK as RANK } from "./rbac";
import type { EntraIdentity } from "./entra";

/**
 * Turning what Entra says about somebody into the role this application
 * enforces.
 *
 * Two sources, in order:
 *
 *   1. App roles declared on the app registration and assigned in Entra. This
 *      is the tidier mechanism -- the value arrives as a name rather than a
 *      GUID, and assignment is visible in the enterprise application.
 *   2. Security group object ids, mapped through configuration, for tenants
 *      that would rather manage this with the groups they already have.
 *
 * Neither is required. With neither configured, SSO still signs people in and
 * their role stays whatever an administrator set in this application, which is
 * the safe default: Entra proves who somebody is, and being able to prove that
 * is not the same as being entitled to approve bookings.
 *
 * A role is never *lowered* from a token. Someone whose group membership has
 * not been set up yet would otherwise be demoted on every sign-in, and an
 * administrator's deliberate assignment would silently lose to a
 * misconfiguration. Raising is likewise refused unless the token actually says
 * so.
 */

/**
 * App role values the application understands, in the words the brief uses.
 * Case-insensitive, and both spaced and unspaced forms are accepted so the
 * value in Entra can read naturally.
 */
const APP_ROLE_TO_ROLE: Record<string, Role> = {
  systemadministrator: Role.SUPER_ADMIN,
  systemadmin: Role.SUPER_ADMIN,
  administrator: Role.FACILITY_ADMIN,
  admin: Role.FACILITY_ADMIN,
  athleticdirector: Role.FACILITY_ADMIN,
  facilityadministrator: Role.FACILITY_ADMIN,
  headcoach: Role.HEAD_COACH,
  coach: Role.HEAD_COACH,
  assistantcoach: Role.ASSISTANT_COACH,
  athletictrainer: Role.TRAINER,
  trainer: Role.TRAINER,
  strengthcoach: Role.STRENGTH_COACH,
  facilities: Role.FACILITIES,
  maintenance: Role.FACILITIES,
  finance: Role.FINANCE,
  businessoffice: Role.FINANCE,
};

function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s._-]/g, "");
}

/**
 * The strongest role the token supports, or null when it says nothing this
 * application recognises.
 */
export function roleFromIdentity(identity: EntraIdentity): Role | null {
  const candidates: Role[] = [];

  for (const claimed of identity.roles) {
    const mapped = APP_ROLE_TO_ROLE[normalise(claimed)];
    if (mapped) candidates.push(mapped);
  }

  for (const groupId of identity.groups) {
    // The map comes from an environment variable, so the value is only a
    // string until checked against the enum. An unrecognised name is ignored
    // rather than trusted.
    const mapped = env.entra.groupRoleMap[groupId.toLowerCase()];
    if (mapped && mapped in Role) candidates.push(Role[mapped as keyof typeof Role]);
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, next) => (RANK[next] > RANK[best] ? next : best));
}

/**
 * What a user's role should become on this sign-in.
 *
 * Only ever raises, and only to something the token actually claims. An
 * EXTERNAL account is never promoted by SSO: an outside renter who happens to
 * exist in the tenant as a guest must not become staff by signing in.
 */
export function reconcileRole(current: Role, fromToken: Role | null): Role {
  if (!fromToken) return current;
  if (current === Role.EXTERNAL) return current;
  return RANK[fromToken] > RANK[current] ? fromToken : current;
}
