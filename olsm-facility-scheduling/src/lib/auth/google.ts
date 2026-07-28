/**
 * Google Workspace SSO for internal staff, and service-account token minting
 * for Calendar writes.
 *
 * Implemented against the REST endpoints with `jose` rather than pulling in
 * googleapis: the surface we need is two endpoints, and this keeps the
 * dependency footprint (and the audit surface) small.
 */

import { SignJWT, importPKCS8 } from "jose";
import { env } from "../env";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function ssoConfigured(): boolean {
  return Boolean(env.google.clientId && env.google.clientSecret);
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
    // Nudges the Google account chooser toward the school tenant.
    hd: env.google.allowedDomains[0] ?? "",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  hostedDomain?: string;
  emailVerified: boolean;
}

export async function exchangeCodeForIdentity(
  code: string,
  redirectUri: string,
): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error("Google token response contained no id_token.");

  const claims = decodeJwtPayload(body.id_token);
  return {
    sub: String(claims.sub),
    email: String(claims.email ?? "").toLowerCase(),
    name: String(claims.name ?? claims.email ?? "Unknown"),
    hostedDomain: claims.hd ? String(claims.hd).toLowerCase() : undefined,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}

/**
 * Domain check. The id_token signature is verified by Google at the token
 * endpoint over TLS with our client secret, so the payload is trusted here;
 * what still has to be enforced is that the account belongs to the school.
 */
export function isAllowedDomain(identity: GoogleIdentity): boolean {
  const domain = identity.hostedDomain ?? identity.email.split("@")[1];
  return env.google.allowedDomains.includes((domain ?? "").toLowerCase());
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("Malformed id_token.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

// ---------------------------------------------------------------------------
// Service account (domain-wide delegation) for Calendar
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

export function serviceAccountConfigured(): boolean {
  return Boolean(
    env.google.serviceAccountEmail &&
      env.google.serviceAccountKey &&
      env.google.impersonateUser,
  );
}

/**
 * Mint an access token for the Calendar API, impersonating the Workspace user
 * that owns the facility calendars.
 */
export async function getCalendarAccessToken(): Promise<string> {
  if (!serviceAccountConfigured()) {
    throw new Error(
      "Google service account is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, " +
        "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and GOOGLE_CALENDAR_IMPERSONATE_USER.",
    );
  }

  // 60s of slack so a token never expires mid-request.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const key = await importPKCS8(env.google.serviceAccountKey, "RS256");
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/calendar",
    sub: env.google.impersonateUser,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(env.google.serviceAccountEmail)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google service-account token request failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return body.access_token;
}

/** Test seam: forget the cached service-account token. */
export function resetCalendarTokenCache(): void {
  cachedToken = null;
}
