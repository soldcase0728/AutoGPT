import { config } from "dotenv";

config({ path: ".env", quiet: true });

// Integration tests run against a separate database so a test run can never
// truncate development data.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.TZ = process.env.TZ || "America/Detroit";
// Keep integrations inert: no live Google, Stripe or mail from a test run.
process.env.EMAIL_PROVIDER = "console";
process.env.SMS_PROVIDER = "console";
process.env.ESIGN_PROVIDER = "manual";
process.env.STORAGE_PROVIDER = "local";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
