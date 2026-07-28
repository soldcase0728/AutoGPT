/**
 * Environment access. Everything optional degrades to a local/dev behaviour so
 * the app boots without a single third-party credential; the integration
 * adapters report themselves as "not configured" rather than throwing.
 */

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
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
    provider: str("EMAIL_PROVIDER", "console") as "sendgrid" | "postmark" | "console",
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
};

export type Env = typeof env;
