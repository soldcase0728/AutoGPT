import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { buildAuthUrl, entraConfigured } from "@/lib/auth/entra";

/**
 * Start an Entra sign-in.
 *
 * Three short-lived values go into httpOnly cookies and are checked on the way
 * back: `state` ties the callback to this browser, `nonce` ties the id_token to
 * this attempt, and the PKCE verifier means an intercepted authorization code
 * cannot be redeemed by anyone else. Ten minutes is generous for a sign-in and
 * short enough that a stale tab cannot be replayed later.
 */
const SHORT_LIVED_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.isProduction,
  path: "/",
  maxAge: 600,
};

export async function GET() {
  if (!entraConfigured()) {
    // Says nothing about what is missing. This is an unauthenticated endpoint.
    return NextResponse.redirect(
      `${env.appUrl}/sign-in?error=${encodeURIComponent("Single sign-on is unavailable. Sign in with your email address and password.")}`,
    );
  }

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const store = await cookies();
  store.set("olsm_entra_state", state, SHORT_LIVED_COOKIE);
  store.set("olsm_entra_nonce", nonce, SHORT_LIVED_COOKIE);
  store.set("olsm_entra_verifier", codeVerifier, SHORT_LIVED_COOKIE);

  return NextResponse.redirect(
    buildAuthUrl({
      state,
      nonce,
      codeChallenge,
      redirectUri: `${env.appUrl}/api/auth/entra/callback`,
    }),
  );
}
