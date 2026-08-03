/**
 * Google Workspace SSO for internal staff.
 *
 * Implemented against the REST endpoints rather than pulling in googleapis: the
 * surface we need is two endpoints, and this keeps the dependency footprint
 * (and the audit surface) small.
 */

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

