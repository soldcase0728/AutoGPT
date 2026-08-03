/**
 * One-time links for setting a password.
 *
 * Used for the invitation an administrator sends a new coach or an outside
 * group, and for the replacement link they send when somebody is locked out.
 * There is no self-service password reset: for fifty known people, "ask the
 * athletic office and they send you a new link" is a smaller and safer system
 * than an unauthenticated endpoint that emails whoever types an address into
 * it, and it leaves a person in the loop.
 *
 * Two rules the rest of the application depends on:
 *
 *   1. Only the hash is stored. The raw token exists in the email and nowhere
 *      else, so reading this table gives an attacker nothing.
 *   2. Consuming is a single atomic write. Two clicks on the same link -- a
 *      double tap, a retry, a scanner racing the human -- resolve to one
 *      success and one expiry, never two.
 */

import "server-only";
import { createHash } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { randomToken } from "./password";

/** How long an invitation stays good. Long enough to survive a weekend. */
export const ACCESS_TOKEN_TTL_HOURS = 7 * 24;

export function hashAccessToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Issue a link for this user, invalidating any earlier unused one.
 *
 * Superseding matters: when somebody says "I never got it" and the office sends
 * another, the first link must stop working. Otherwise a link sitting in a
 * forwarded email or a shared inbox stays live for its full week.
 *
 * Returns the raw token. It is never readable again after this call.
 */
export async function issueAccessToken(params: {
  userId: string;
  issuedById?: string | null;
  ttlHours?: number;
}): Promise<string> {
  const raw = randomToken(32);
  const ttl = params.ttlHours ?? ACCESS_TOKEN_TTL_HOURS;

  await prisma.$transaction([
    prisma.accessToken.updateMany({
      where: { userId: params.userId, consumedAt: null },
      data: { expiresAt: new Date(0) },
    }),
    prisma.accessToken.create({
      data: {
        tokenHash: hashAccessToken(raw),
        userId: params.userId,
        issuedById: params.issuedById ?? null,
        expiresAt: new Date(Date.now() + ttl * 3_600_000),
      },
    }),
  ]);

  return raw;
}

export type AccessTokenLookup =
  | { ok: true; user: User }
  | { ok: false; reason: "unknown" | "expired" | "used" | "inactive" };

/**
 * Look at a token without spending it.
 *
 * This is what the landing page calls. Rendering a page must not consume the
 * link: Microsoft Defender Safe Links and similar scanners fetch every URL in
 * inbound mail, and a link that is spent on GET is a link the recipient always
 * finds already used. The token is spent on submit, in `consumeAccessToken`.
 */
export async function inspectAccessToken(raw: string): Promise<AccessTokenLookup> {
  const record = await prisma.accessToken.findUnique({
    where: { tokenHash: hashAccessToken(raw) },
    include: { user: true },
  });

  if (!record) return { ok: false, reason: "unknown" };
  if (record.consumedAt) return { ok: false, reason: "used" };
  if (record.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (!record.user.active) return { ok: false, reason: "inactive" };

  return { ok: true, user: record.user };
}

/**
 * Spend the token. One caller wins; anybody arriving after gets `used`.
 *
 * The guard lives in the WHERE clause rather than in a read followed by a
 * write, so two simultaneous submissions cannot both pass it.
 */
export async function consumeAccessToken(raw: string): Promise<AccessTokenLookup> {
  const now = new Date();
  const tokenHash = hashAccessToken(raw);

  const claimed = await prisma.accessToken.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });

  if (claimed.count !== 1) {
    // Nothing was claimed. Say precisely why, so the page can tell the reader
    // whether to ask for a new link or simply sign in.
    return await inspectAccessToken(raw);
  }

  const record = await prisma.accessToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || !record.user.active) return { ok: false, reason: "inactive" };
  return { ok: true, user: record.user };
}

/**
 * What to tell somebody whose link did not work.
 *
 * Each case gets its own next step. "Already used" is the one that matters: it
 * usually means they set a password a moment ago and pressed back, so the
 * answer is to sign in, not to ask the office for another link.
 */
export function accessTokenMessage(reason: "unknown" | "expired" | "used" | "inactive"): string {
  switch (reason) {
    case "used":
      return "That link has already been used. If that was you, sign in with the password you chose.";
    case "expired":
      return "That link has expired. Ask the athletic office to send you another.";
    case "inactive":
      return "That account is switched off. Contact the athletic office.";
    default:
      return "That link is not valid. Check you copied the whole address, or ask the athletic office to send another.";
  }
}

/** Drop spent and expired rows. Called by the nightly maintenance job. */
export async function pruneAccessTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const result = await prisma.accessToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}
