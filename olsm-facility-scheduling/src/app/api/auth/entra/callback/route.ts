import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { createSession } from "@/lib/auth/session";
import { EntraSignInError, exchangeCodeForIdentity, isAllowedDomain } from "@/lib/auth/entra";
import { reconcileRole, roleFromIdentity } from "@/lib/auth/entra-roles";

/**
 * What the user is told when sign-in fails.
 *
 * Deliberately incurious: no tenant id, no client id, no provider message, no
 * indication of whether an account exists. The detail goes to the server log
 * and, where there is an identity to attach it to, the audit trail.
 */
function deny(reason: string, detail?: string): NextResponse {
  if (detail) console.warn(`entra sign-in denied: ${detail}`);
  return NextResponse.redirect(`${env.appUrl}/sign-in?error=${encodeURIComponent(reason)}`);
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const providerError = request.nextUrl.searchParams.get("error");

  const store = await cookies();
  const expectedState = store.get("olsm_entra_state")?.value;
  const expectedNonce = store.get("olsm_entra_nonce")?.value;
  const codeVerifier = store.get("olsm_entra_verifier")?.value;

  // Single use, whatever the outcome.
  store.delete("olsm_entra_state");
  store.delete("olsm_entra_nonce");
  store.delete("olsm_entra_verifier");

  if (providerError) {
    // Includes the ordinary "user cancelled" case, which is not an error worth
    // alarming anybody about.
    return deny("Sign-in was not completed.", `provider returned error=${providerError}`);
  }

  if (!code || !state || !expectedState || !expectedNonce || !codeVerifier) {
    return deny("Sign-in could not be verified. Please try again.", "missing code, state or PKCE cookie");
  }

  if (!constantTimeEqual(state, expectedState)) {
    return deny("Sign-in could not be verified. Please try again.", "state mismatch");
  }

  let identity;
  try {
    identity = await exchangeCodeForIdentity({
      code,
      codeVerifier,
      redirectUri: `${env.appUrl}/api/auth/entra/callback`,
      expectedNonce,
    });
  } catch (error) {
    if (error instanceof EntraSignInError) {
      return deny(error.publicReason, error.message);
    }
    return deny("Sign-in could not be completed.", String(error));
  }

  if (!isAllowedDomain(identity)) {
    await recordAudit({
      entityType: "user",
      entityId: identity.oid,
      action: "auth.sso_rejected_domain",
      actorLabel: identity.email,
      reason: "Address is outside the domains permitted for staff sign-in.",
    });
    return deny("Use your OLSM work account to sign in.");
  }

  // SSO links to an existing account; it never creates one. Being able to prove
  // who you are in the tenant is not the same as being entitled to book a gym,
  // so an unknown address is turned away rather than silently provisioned.
  // Matched on the Entra object id first: it survives a rename or an address
  // change, which the email address does not.
  const user = await prisma.user.findFirst({
    where: { OR: [{ entraOid: identity.oid }, { email: identity.email }] },
  });

  if (!user || !user.active) {
    await recordAudit({
      entityType: "user",
      entityId: identity.oid,
      action: "auth.sso_rejected_unknown_account",
      actorLabel: identity.email,
      reason: "No active account exists for this Entra identity.",
    });
    return deny("No account exists for that address. Ask the athletic office to set one up.");
  }

  // Role from the token, but only ever upwards, and never onto an EXTERNAL
  // account -- an outside renter who is a guest in the tenant must not become
  // staff by signing in.
  const claimed = roleFromIdentity(identity);
  const nextRole = reconcileRole(user.role, claimed);

  const changes: { entraOid?: string; role?: Role } = {};
  if (user.entraOid !== identity.oid) changes.entraOid = identity.oid;
  if (nextRole !== user.role) changes.role = nextRole;

  if (Object.keys(changes).length > 0) {
    await prisma.user.update({ where: { id: user.id }, data: changes });
    if (changes.role) {
      await recordAudit({
        entityType: "user",
        entityId: user.id,
        action: "auth.role_raised_from_sso",
        actorId: user.id,
        actorLabel: user.name,
        fromState: user.role,
        toState: changes.role,
        reason: "Entra assignment grants a higher role than the local record held.",
      });
    }
  }

  await createSession({ ...user, role: nextRole });
  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: "auth.sign_in_sso",
    actorId: user.id,
    actorLabel: user.name,
    payload: { provider: "entra" },
  });

  return NextResponse.redirect(
    `${env.appUrl}${nextRole === Role.EXTERNAL ? "/portal" : "/calendar"}`,
  );
}
