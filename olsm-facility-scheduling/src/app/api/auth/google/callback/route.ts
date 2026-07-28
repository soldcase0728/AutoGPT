import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { createSession } from "@/lib/auth/session";
import { exchangeCodeForIdentity, isAllowedDomain } from "@/lib/auth/google";

function deny(reason: string): NextResponse {
  return NextResponse.redirect(`${env.appUrl}/sign-in?error=${encodeURIComponent(reason)}`);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get("olsm_oauth_state")?.value;
  store.delete("olsm_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return deny("Sign-in could not be verified. Please try again.");
  }

  let identity;
  try {
    identity = await exchangeCodeForIdentity(code, `${env.appUrl}/api/auth/google/callback`);
  } catch {
    return deny("Google sign-in failed. Please try again.");
  }

  if (!identity.emailVerified || !isAllowedDomain(identity)) {
    return deny("Use your OLSM Google account to sign in.");
  }

  // SSO links to an existing account; it never creates one and never grants a
  // role. Role assignment is admin-controlled, so an unknown OLSM address is
  // turned away rather than silently provisioned.
  const user = await prisma.user.findFirst({
    where: { OR: [{ googleSub: identity.sub }, { email: identity.email }] },
  });

  if (!user || !user.active) {
    await recordAudit({
      entityType: "user",
      entityId: identity.sub,
      action: "auth.sso_rejected_unknown_account",
      actorLabel: identity.email,
      reason: "No active account exists for this Google identity.",
    });
    return deny("No account exists for that address. Ask the athletic office to set one up.");
  }

  if (!user.googleSub) {
    await prisma.user.update({ where: { id: user.id }, data: { googleSub: identity.sub } });
  }

  await createSession(user);
  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: "auth.sign_in_sso",
    actorId: user.id,
    actorLabel: user.name,
  });

  return NextResponse.redirect(
    `${env.appUrl}${user.role === Role.EXTERNAL ? "/portal" : "/calendar"}`,
  );
}
