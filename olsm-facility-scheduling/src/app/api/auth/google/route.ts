import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthUrl, ssoConfigured } from "@/lib/auth/google";
import { randomToken } from "@/lib/auth/password";
import { env } from "@/lib/env";

/** Start the Google Workspace SSO flow. */
export async function GET() {
  if (!ssoConfigured()) {
    return NextResponse.json(
      { error: "Google Workspace sign-in is not configured." },
      { status: 501 },
    );
  }

  // CSRF: the state is echoed back by Google and compared against the cookie.
  const state = randomToken(24);
  const store = await cookies();
  store.set("olsm_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthUrl(state, `${env.appUrl}/api/auth/google/callback`));
}
