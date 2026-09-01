import "server-only";

/**
 * Microsoft Graph, app-only. The export runs on a schedule with nobody signed
 * in, so it uses the client credentials flow and an application permission
 * (Sites.Selected, granted on the one target site — see the README).
 */

const LOGIN = "https://login.microsoftonline.com";
export const GRAPH = "https://graph.microsoft.com/v1.0";

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  folder: string;
}

export function graphConfig(): GraphConfig | null {
  const {
    MS_TENANT_ID: tenantId,
    MS_CLIENT_ID: clientId,
    MS_CLIENT_SECRET: clientSecret,
    MS_DRIVE_ID: driveId,
  } = process.env;

  if (!tenantId || !clientId || !clientSecret || !driveId) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    driveId,
    folder: (process.env.MS_EXPORT_FOLDER || "Student captures").replace(/^\/+|\/+$/g, ""),
  };
}

let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(config: GraphConfig): Promise<string> {
  // Tokens last an hour; re-fetch a minute early rather than racing expiry.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const response = await fetch(`${LOGIN}/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Microsoft token request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return cached.token;
}

/** Only for tests and for forcing a refresh after a credential change. */
export function clearTokenCache() {
  cached = null;
}

/** Encodes a folder path for Graph's `root:/{path}:` addressing. */
export function encodeDrivePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
