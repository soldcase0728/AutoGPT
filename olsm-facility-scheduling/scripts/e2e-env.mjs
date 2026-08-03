import { config } from "dotenv";

/**
 * Environment for the end-to-end suite.
 *
 * The e2e run gets its own database and its own fixture token, set here rather
 * than in `.env`, so a developer's normal `npm run dev` can never accidentally
 * expose the fixture endpoints or write to the e2e database.
 */
config({ path: ".env", quiet: true });

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.TEST_DATABASE_URL?.replace(/olsm_facilities_test/, "olsm_facilities_e2e") ??
  "postgresql://olsm:olsm@127.0.0.1:5432/olsm_facilities_e2e?schema=public";

export const E2E_TOKEN = process.env.E2E_TOKEN ?? "e2e-local-token";
export const E2E_PORT = process.env.E2E_PORT ?? "3210";

export function e2eEnv(extra = {}) {
  return {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    E2E_TOKEN,
    // A production build served on http://127.0.0.1 is exactly what the
    // production APP_URL guard exists to reject, and exactly what this suite
    // needs. Opt out here rather than weakening the guard.
    ALLOW_INSECURE_APP_URL: "1",
    // Integrations stay inert: an e2e run must not email a real coach.
    EMAIL_PROVIDER: "console",
    SMS_PROVIDER: "console",
    ESIGN_PROVIDER: "manual",
    STORAGE_PROVIDER: "local",
    STRIPE_SECRET_KEY: "",
    ...extra,
  };
}
