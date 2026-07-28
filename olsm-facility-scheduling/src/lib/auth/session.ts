/**
 * Session handling.
 *
 * A signed JWT in an httpOnly cookie, backed by a Session row so an admin can
 * revoke a session immediately (deactivating a coach mid-season should log them
 * out, not wait for token expiry).
 */

import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { Role, User } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";

const COOKIE_NAME = "olsm_session";
const SESSION_DAYS = 14;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

export interface SessionClaims {
  sub: string; // user id
  sid: string; // session row id
  role: Role;
  email: string;
  name: string;
}

export async function createSession(user: Pick<User, "id" | "role" | "email" | "name">) {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt },
  });

  const token = await new SignJWT({
    sid: session.id,
    role: user.role,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secretKey());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    expires: expiresAt,
  });

  return session;
}

export async function readSessionToken(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.sid !== "string") return null;
    return {
      sub: payload.sub,
      sid: payload.sid,
      role: payload.role as Role,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const claims = await readSessionToken();
  if (claims) {
    await prisma.session.deleteMany({ where: { id: claims.sid } });
  }
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Drop expired session rows. Called by the nightly maintenance job. */
export async function pruneSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
