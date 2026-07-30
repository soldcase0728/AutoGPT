/**
 * Microsoft Entra ID single sign-on for OLSM staff, and client-credentials
 * tokens for Microsoft Graph.
 *
 * Written against the OIDC endpoints with `jose` rather than MSAL: the surface
 * needed here is an authorize redirect, a token exchange and a signature check,
 * and a smaller dependency is a smaller thing to audit.
 *
 * Three things do the work of keeping other people out:
 *
 *   1. A tenant-specific authority. Issuing against
 *      /{tenantId}/v2.0 rather than /common or /organizations means Entra
 *      itself refuses personal Microsoft accounts and accounts from other
 *      tenants before a token is ever minted.
 *   2. The `tid` claim is compared to the configured tenant anyway. Authority
 *      URLs are configuration and configuration can be wrong; a token from a
 *      tenant we did not mean is rejected here regardless.
 *   3. The id_token signature is verified against the tenant's published JWKS,
 *      with issuer, audience and nonce all checked. The token arrives over TLS
 *      from Microsoft, but verifying it is cheap and means a bug elsewhere in
 *      the flow cannot turn into an accepted forgery.
 *
 * Nothing here ever puts a tenant id, client secret, token or raw provider
 * error in front of a user. Callers get a short reason code; the detail goes to
 * the server log and the audit trail.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env";

function authority(): string {
  return `https://login.microsoftonline.com/${env.entra.tenantId}`;
}

export function entraConfigured(): boolean {
  return Boolean(env.entra.tenantId && env.entra.clientId && env.entra.clientSecret);
}

/** Cached across requests: the key set rotates rarely and `jose` handles it. */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function keySet() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${authority()}/discovery/v2.0/keys`));
  }
  return jwks;
}

/** Test seam, and used when configuration changes under a long-lived process. */
export function resetEntraKeyCache(): void {
  jwks = null;
}

export function buildAuthUrl(options: {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: env.entra.clientId,
    response_type: "code",
    redirect_uri: options.redirectUri,
    response_mode: "query",
    // openid/profile/email identify the person. offline_access is deliberately
    // absent: this signs somebody in, it does not act on their behalf later, so
    // there is no refresh token to store or leak.
    scope: "openid profile email",
    state: options.state,
    nonce: options.nonce,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    // Send the account picker to the school tenant.
    domain_hint: env.entra.allowedDomains[0] ?? "",
  });
  return `${authority()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export interface EntraIdentity {
  /** Immutable per-user id within the tenant. Stable across renames. */
  oid: string;
  tenantId: string;
  email: string;
  name: string;
  /** App roles assigned in Entra, if the app registration defines any. */
  roles: string[];
  /** Group object ids, when the token is configured to carry them. */
  groups: string[];
}

/**
 * Errors a caller may surface. The strings are deliberately vague -- a sign-in
 * page is an unauthenticated surface and should not describe our configuration
 * to whoever is knocking.
 */
export class EntraSignInError extends Error {
  readonly publicReason: string;

  constructor(publicReason: string, detail: string) {
    super(detail);
    this.name = "EntraSignInError";
    this.publicReason = publicReason;
  }
}

export async function exchangeCodeForIdentity(options: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  expectedNonce: string;
}): Promise<EntraIdentity> {
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.entra.clientId,
      client_secret: env.entra.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
      grant_type: "authorization_code",
      code_verifier: options.codeVerifier,
      scope: "openid profile email",
    }),
  });

  if (!res.ok) {
    // The body can echo client_id and tenant detail; it goes to the log only.
    throw new EntraSignInError(
      "Sign-in could not be completed.",
      `Entra token exchange failed (${res.status}): ${await res.text()}`,
    );
  }

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) {
    throw new EntraSignInError(
      "Sign-in could not be completed.",
      "Entra token response contained no id_token.",
    );
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(body.id_token, keySet(), {
      issuer: `${authority()}/v2.0`,
      audience: env.entra.clientId,
      clockTolerance: 60,
    }));
  } catch (error) {
    throw new EntraSignInError(
      "Sign-in could not be verified.",
      `Entra id_token verification failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  // Replay protection: this token must belong to the redirect we started.
  if (payload.nonce !== options.expectedNonce) {
    throw new EntraSignInError(
      "Sign-in could not be verified.",
      "Entra id_token nonce did not match the value issued for this attempt.",
    );
  }

  const tid = String(payload.tid ?? "");
  if (!tid || tid !== env.entra.tenantId) {
    // Belt and braces over the tenant-specific authority. A personal Microsoft
    // account carries the well-known consumers tenant and lands here too.
    throw new EntraSignInError(
      "Use your OLSM work account to sign in.",
      `Entra id_token tid "${tid}" is not the configured tenant.`,
    );
  }

  const email = String(
    payload.preferred_username ?? payload.email ?? payload.upn ?? "",
  ).toLowerCase();

  if (!email) {
    throw new EntraSignInError(
      "That account has no usable email address.",
      "Entra id_token carried no preferred_username, email or upn claim.",
    );
  }

  return {
    oid: String(payload.oid ?? payload.sub),
    tenantId: tid,
    email,
    name: String(payload.name ?? email),
    roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
    groups: Array.isArray(payload.groups) ? payload.groups.map(String) : [],
  };
}

/**
 * Domain check on top of the tenant check.
 *
 * A tenant can host guest accounts from other domains, and a guest is not an
 * OLSM employee. Left empty, this check is skipped and tenant membership alone
 * decides.
 */
export function isAllowedDomain(identity: EntraIdentity): boolean {
  if (env.entra.allowedDomains.length === 0) return true;
  const domain = identity.email.split("@")[1] ?? "";
  return env.entra.allowedDomains.includes(domain.toLowerCase());
}

// ---------------------------------------------------------------------------
// Client credentials, for Microsoft Graph
// ---------------------------------------------------------------------------

let cachedGraphToken: { token: string; expiresAt: number } | null = null;

export function graphConfigured(): boolean {
  return Boolean(
    env.entra.tenantId && env.entra.clientId && env.entra.clientSecret && env.graph.senderMailbox,
  );
}

/**
 * An application token for Graph, using the same app registration as sign-in.
 *
 * Application permissions rather than delegated: mail is sent by the system on
 * a schedule, with nobody signed in. The permission that needs granting is
 * Mail.Send, and it should be narrowed to the one mailbox with an application
 * access policy -- see DEPLOY.md. Mail.Send unrestricted lets this application
 * send as anybody in the tenant, which is far more than it needs.
 */
export async function getGraphAccessToken(): Promise<string> {
  if (!graphConfigured()) {
    throw new Error("Microsoft Graph is not configured.");
  }

  // 60s of slack so a token never expires mid-send.
  if (cachedGraphToken && cachedGraphToken.expiresAt > Date.now() + 60_000) {
    return cachedGraphToken.token;
  }

  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.entra.clientId,
      client_secret: env.entra.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status}).`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedGraphToken = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return body.access_token;
}

/** Test seam: forget the cached Graph token. */
export function resetGraphTokenCache(): void {
  cachedGraphToken = null;
}
