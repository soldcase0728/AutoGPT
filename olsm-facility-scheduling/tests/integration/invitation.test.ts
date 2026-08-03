/**
 * Getting into the system at all.
 *
 * Before this existed, every account in the database came from the seed: sign-in
 * through Entra deliberately refuses to provision an unknown address, and no
 * screen could add one. A coach hired in October and a club renting the gym were
 * equally stuck. These tests cover the way in and the ways it must not be abused.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { db, ensureMigrated, userByEmail } from "../helpers/db";
import {
  consumeAccessToken,
  hashAccessToken,
  inspectAccessToken,
  issueAccessToken,
  pruneAccessTokens,
} from "@/lib/auth/access-token";

beforeAll(() => {
  ensureMigrated();
});

const INVITEE = "invited.coach@example.test";

async function makeInvitee(over: { active?: boolean; passwordHash?: string | null } = {}) {
  return db.user.create({
    data: {
      name: "Invited Coach",
      email: INVITEE,
      role: Role.ASSISTANT_COACH,
      passwordHash: over.passwordHash ?? null,
      emailVerifiedAt: null,
      active: over.active ?? true,
    },
  });
}

beforeEach(async () => {
  // Tokens cascade with the user.
  await db.user.deleteMany({ where: { email: INVITEE } });
});

describe("the emailed token is not stored", () => {
  it("keeps only a hash, so reading the table yields nothing usable", async () => {
    const user = await makeInvitee();
    const token = await issueAccessToken({ userId: user.id });

    const rows = await db.accessToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toBe(hashAccessToken(token));

    // The raw value appears in no column of the row.
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it("issues a different token every time", async () => {
    const user = await makeInvitee();
    const a = await issueAccessToken({ userId: user.id });
    const b = await issueAccessToken({ userId: user.id });
    expect(a).not.toBe(b);
  });
});

describe("looking at a link does not spend it", () => {
  it("survives being inspected repeatedly", async () => {
    // This is the Safe Links case: a scanner fetches the URL before the human
    // does. Rendering the page must leave the token usable.
    const user = await makeInvitee();
    const token = await issueAccessToken({ userId: user.id });

    for (let i = 0; i < 5; i += 1) {
      const look = await inspectAccessToken(token);
      expect(look.ok).toBe(true);
    }

    const claim = await consumeAccessToken(token);
    expect(claim.ok).toBe(true);
    if (claim.ok) expect(claim.user.id).toBe(user.id);
  });
});

describe("a link works once", () => {
  it("reports the second use as already used", async () => {
    const user = await makeInvitee();
    const token = await issueAccessToken({ userId: user.id });

    expect((await consumeAccessToken(token)).ok).toBe(true);

    const second = await consumeAccessToken(token);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("used");
  });

  it("resolves two simultaneous submissions to exactly one winner", async () => {
    // A double tap, or a retry racing the original. Both requests reach the
    // same row; the guard is in the WHERE clause so only one can claim it.
    const user = await makeInvitee();
    const token = await issueAccessToken({ userId: user.id });

    const results = await Promise.all([
      consumeAccessToken(token),
      consumeAccessToken(token),
      consumeAccessToken(token),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(2);
  });
});

describe("issuing a new link retires the old one", () => {
  it("stops the first link working once a replacement is sent", async () => {
    // "I never got it" is answered by sending another. The first must die --
    // otherwise a link sitting in a forwarded email stays live for a week.
    const user = await makeInvitee();
    const first = await issueAccessToken({ userId: user.id });
    const second = await issueAccessToken({ userId: user.id });

    const stale = await consumeAccessToken(first);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("expired");

    expect((await consumeAccessToken(second)).ok).toBe(true);
  });
});

describe("links that should not work", () => {
  it("refuses an expired token", async () => {
    const user = await makeInvitee();
    const token = await issueAccessToken({ userId: user.id, ttlHours: -1 });

    const claim = await consumeAccessToken(token);
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.reason).toBe("expired");
  });

  it("refuses a token for a deactivated account", async () => {
    const user = await makeInvitee();
    const token = await issueAccessToken({ userId: user.id });
    await db.user.update({ where: { id: user.id }, data: { active: false } });

    const claim = await consumeAccessToken(token);
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.reason).toBe("inactive");
  });

  it("refuses a token nobody issued", async () => {
    const claim = await consumeAccessToken("not-a-real-token");
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.reason).toBe("unknown");
  });

  it("does not accept the stored hash in place of the token", async () => {
    // Guards against a reversal of the lookup: if the code ever compared the
    // raw input to the stored column, a database read would become a login.
    const user = await makeInvitee();
    const token = await issueAccessToken({ userId: user.id });
    const row = await db.accessToken.findFirstOrThrow({ where: { userId: user.id } });

    const claim = await consumeAccessToken(row.tokenHash);
    expect(claim.ok).toBe(false);
    expect((await inspectAccessToken(token)).ok).toBe(true);
  });
});

describe("a reset is the same mechanism as an invitation", () => {
  it("issues a usable link for somebody who already has a password", async () => {
    const user = await makeInvitee({ passwordHash: "$2a$12$notarealhashatall" });
    const token = await issueAccessToken({ userId: user.id });

    const look = await inspectAccessToken(token);
    expect(look.ok).toBe(true);
    // The page uses this to say "choose a new password" rather than "welcome".
    if (look.ok) expect(look.user.passwordHash).not.toBeNull();
  });
});

describe("housekeeping", () => {
  it("clears expired rows and leaves live ones alone", async () => {
    const user = await makeInvitee();
    await issueAccessToken({ userId: user.id, ttlHours: -1 });
    const live = await issueAccessToken({ userId: user.id });

    await pruneAccessTokens();

    const remaining = await db.accessToken.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tokenHash).toBe(hashAccessToken(live));
  });
});

describe("the seeded staff are unaffected", () => {
  it("leaves existing password sign-in working", async () => {
    // The invitation flow is additive: it must not disturb the accounts the
    // seed creates, which are how anybody gets in for the first time.
    const ad = await userByEmail("ad@olsm.edu");
    expect(ad.passwordHash).toBeTruthy();
    expect(ad.role).toBe(Role.SUPER_ADMIN);
  });
});
