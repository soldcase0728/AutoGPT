/**
 * Environment access. Everything optional degrades to a local/dev behaviour so
 * the app boots without a single third-party credential; the integration
 * adapters report themselves as "not configured" rather than throwing.
 */

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

/**
 * "<guid>=FACILITY_ADMIN,<guid>=FINANCE" into a lookup.
 *
 * Unknown role names are dropped rather than throwing: a typo in this variable
 * should cost that one mapping, not the ability to start the application.
 */
function parseGroupRoleMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [id, role] = pair.split("=").map((part) => part.trim());
    if (id && role) out[id.toLowerCase()] = role.toUpperCase();
  }
  return out;
}

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

export const env = {
  appUrl: str("APP_URL", "http://localhost:3000"),
  databaseUrl: str("DATABASE_URL"),
  sessionSecret: str("SESSION_SECRET", "insecure-development-secret-change-me-now"),
  timezone: str("TZ", "America/Detroit"),
  isProduction: process.env.NODE_ENV === "production",

  google: {
    clientId: str("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: str("GOOGLE_OAUTH_CLIENT_SECRET"),
    allowedDomains: str("GOOGLE_ALLOWED_DOMAINS", "olsm.edu")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    serviceAccountEmail: str("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    serviceAccountKey: str("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
    impersonateUser: str("GOOGLE_CALENDAR_IMPERSONATE_USER"),
    calendarWebhookToken: str("GOOGLE_CALENDAR_WEBHOOK_TOKEN"),
  },

  /**
   * Microsoft Entra ID. The tenant id makes the authority tenant-specific,
   * which is what refuses personal Microsoft accounts and other tenants before
   * a token is issued at all.
   */
  entra: {
    tenantId: str("ENTRA_TENANT_ID"),
    clientId: str("ENTRA_CLIENT_ID"),
    clientSecret: str("ENTRA_CLIENT_SECRET"),
    /** Guest accounts live in the tenant too; empty means tenant alone decides. */
    allowedDomains: str("ENTRA_ALLOWED_DOMAINS")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    /** "<group-object-id>=FACILITY_ADMIN,<group-object-id>=FINANCE" */
    groupRoleMap: parseGroupRoleMap(str("ENTRA_GROUP_ROLE_MAP")),
  },

  graph: {
    /** The one mailbox this application is permitted to send as. */
    senderMailbox: str("GRAPH_SENDER_MAILBOX"),
  },

  stripe: {
    secretKey: str("STRIPE_SECRET_KEY"),
    webhookSecret: str("STRIPE_WEBHOOK_SECRET"),
  },

  esign: {
    provider: str("ESIGN_PROVIDER", "manual") as "docusign" | "dropbox_sign" | "manual",
    webhookSecret: str("ESIGN_WEBHOOK_SECRET"),
    docusign: {
      baseUri: str("DOCUSIGN_BASE_URI"),
      accountId: str("DOCUSIGN_ACCOUNT_ID"),
      integrationKey: str("DOCUSIGN_INTEGRATION_KEY"),
      userId: str("DOCUSIGN_USER_ID"),
      privateKey: str("DOCUSIGN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    },
    dropboxSign: {
      apiKey: str("DROPBOX_SIGN_API_KEY"),
    },
  },

  email: {
    provider: str("EMAIL_PROVIDER", "console") as "graph" | "sendgrid" | "postmark" | "console",
    from: str("EMAIL_FROM", "athletics@olsm.edu"),
    sendgridKey: str("SENDGRID_API_KEY"),
    postmarkToken: str("POSTMARK_SERVER_TOKEN"),
  },

  sms: {
    provider: str("SMS_PROVIDER", "console") as "twilio" | "console",
    accountSid: str("TWILIO_ACCOUNT_SID"),
    authToken: str("TWILIO_AUTH_TOKEN"),
    from: str("TWILIO_FROM_NUMBER"),
  },

  storage: {
    provider: str("STORAGE_PROVIDER", "local") as "s3" | "gcs" | "local",
    bucket: str("STORAGE_BUCKET"),
    localDir: str("STORAGE_LOCAL_DIR", "./.storage"),
  },

  jobRunnerToken: str("JOB_RUNNER_TOKEN"),
  seedDemoData: bool("SEED_DEMO_DATA", true),

  /**
   * Whether someone with no account may submit a facility request.
   *
   * Off. Every hold then belongs to an account the school issued, which is the
   * whole anti-abuse story a tool for a known group needs. Turning this on
   * re-opens a path that also needs verified email, single-use tokens and rate
   * limits before it faces the public.
   */
  allowAnonymousRequests: bool("ALLOW_ANONYMOUS_REQUESTS", false),
};

/**
 * The database name from a connection URL.
 *
 * Used by the guards that refuse to touch anything but a disposable database.
 * Parsed properly rather than by splitting on "/", because a connection string
 * carrying a socket directory -- `?host=/var/run/postgresql`, which is how
 * Postgres is commonly reached on a Unix socket -- ends in a path segment that
 * is not the database at all. Both guards previously read "postgresql" or "tmp"
 * as the database name and refused to run. They failed safe, but a guard that
 * reads the wrong field is not a guard, and it is one URL shape away from
 * failing the other way.
 *
 * Returns "" for anything unparseable, which no guard treats as disposable.
 */
export function databaseNameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

/** True only for a database whose name marks it as safe to wipe. */
export function isDisposableDatabase(url: string): boolean {
  return /_e2e$|_test$/.test(databaseNameFromUrl(url));
}

/**
 * Whether real email can leave this instance.
 *
 * The "console" provider writes to stdout, which is right for development and
 * useless to a renter waiting on a sign-in link. Anything that depends on a
 * person receiving mail -- an invitation, a claimed request, a rejected
 * document -- must check this rather than assume delivery.
 */
export function emailIsDeliverable(): boolean {
  if (env.email.provider === "graph") {
    return Boolean(env.entra.tenantId && env.entra.clientId && env.entra.clientSecret && env.graph.senderMailbox);
  }
  if (env.email.provider === "sendgrid") return Boolean(env.email.sendgridKey);
  if (env.email.provider === "postmark") return Boolean(env.email.postmarkToken);
  return false;
}

/**
 * Configuration that must be right before production serves a request.
 *
 * Each of these fails silently otherwise, which is the dangerous kind: links in
 * emails that point at localhost, a session secret published in this
 * repository, or an APP_URL taken from wherever the last deploy happened to
 * run. Tokens must be built from a known-good origin rather than from anything
 * a caller can influence, so APP_URL is validated here and never derived from
 * an incoming Host header.
 */
export function productionConfigProblems(): string[] {
  if (!env.isProduction) return [];

  const problems: string[] = [];
  const raw = str("APP_URL");

  // A production *build* is not always a production *deployment*. The e2e suite
  // and the Docker Compose route both run this build on a local host over
  // plain http quite legitimately. This opt-in is for those; it is never set on
  // a hosted service, where an http or loopback APP_URL means real links go
  // somewhere nobody can reach.
  const allowInsecureUrl = bool("ALLOW_INSECURE_APP_URL", false);

  if (!raw) {
    problems.push("APP_URL is not set. It must be the public https URL of this instance.");
  } else {
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`APP_URL is not a valid URL: ${raw}`);
    }

    if (url) {
      if (!allowInsecureUrl) {
        if (url.protocol !== "https:") {
          problems.push(`APP_URL must use https, not ${url.protocol.replace(":", "")}.`);
        }
        if (/^(localhost$|127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(url.hostname)) {
          problems.push(
            `APP_URL points at ${url.hostname}, which nobody outside this container can reach.`,
          );
        }
      }

      // Always enforced when configured. This is the "is this the host we meant"
      // check, and a local run that opts out of the https rule still should not
      // be allowed to claim a production hostname.
      const allowed = str("APP_URL_ALLOWED_HOSTS")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(url.hostname.toLowerCase())) {
        problems.push(
          `APP_URL host "${url.hostname}" is not in APP_URL_ALLOWED_HOSTS (${allowed.join(", ")}).`,
        );
      }
    }
  }

  if (env.sessionSecret.length < 32) {
    problems.push("SESSION_SECRET must be at least 32 characters.");
  }
  if (env.sessionSecret.startsWith("insecure-development-secret")) {
    problems.push("SESSION_SECRET is still the development default.");
  }

  return problems;
}

/**
 * Called once at startup. Refusing to boot is deliberate: a production instance
 * that runs with a broken APP_URL emails links nobody can use and looks healthy
 * doing it, which is harder to notice than a container that will not start.
 */
export function assertProductionConfig(): void {
  const problems = productionConfigProblems();
  if (problems.length === 0) return;

  const message = [
    "FATAL: this instance is not configured for production.",
    "",
    ...problems.map((p) => `  - ${p}`),
    "",
    "Set these on the service and redeploy.",
  ].join("\n");

  throw new Error(message);
}

export type Env = typeof env;
