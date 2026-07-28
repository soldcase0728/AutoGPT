import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../db";
import { ForbiddenError } from "../errors";
import { readSessionToken } from "./session";
import { can, isAdmin, type Permission } from "./rbac";

export type CurrentUser = Prisma.UserGetPayload<{
  include: { sports: { include: { sport: true } }; organization: true };
}>;

/**
 * Resolved once per request. The session row is re-checked on every request so
 * deactivating a user takes effect immediately rather than at token expiry.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const claims = await readSessionToken();
  if (!claims) return null;

  const session = await prisma.session.findUnique({ where: { id: claims.sid } });
  if (!session || session.expiresAt < new Date() || session.userId !== claims.sub) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    include: { sports: { include: { sport: true } }, organization: true },
  });

  if (!user || !user.active) return null;
  return user;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * Page and action guards.
 *
 * These redirect rather than throw: a coach who follows a stale link to an
 * admin screen should see an explanation, not a 500. Service-layer functions
 * still throw ForbiddenError, which is what protects the data itself -- these
 * are the navigation-level guard.
 */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/forbidden");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdmin(user.role)) redirect("/forbidden");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}

/** Throwing variant, for service and action code paths. */
export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new ForbiddenError(`Your role (${user.role}) cannot perform this action.`);
  }
  return user;
}

/** Sports where this user is the head coach; used for approval routing. */
export function headCoachSportIds(user: CurrentUser): string[] {
  return user.sports.filter((s) => s.isHead).map((s) => s.sportId);
}

export function sportIds(user: CurrentUser): string[] {
  return user.sports.map((s) => s.sportId);
}
