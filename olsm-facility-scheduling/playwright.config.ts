import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * End-to-end tests.
 *
 * These cover the paths where a mistake is expensive and where the interesting
 * behaviour is spread across server actions, the database and the browser:
 * a coach booking in one pass, a paid booking being gated, a blocked account,
 * and a participant signing a waiver with no account at all.
 *
 * They run against a production build with its own database, seeded fresh, so a
 * run never depends on -- or damages -- development data.
 */

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Some environments ship a Chromium build that does not match the version
 * Playwright expects to download. When that build is present, point at it
 * rather than fetching another copy.
 */
const PREINSTALLED_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = existsSync(PREINSTALLED_CHROME) ? PREINSTALLED_CHROME : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  // Server actions mutate shared rows; parallel workers would fight over slots.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    // Coaches book from the field. If it breaks on a phone it is broken.
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
  ],

  webServer: {
    command: `npm run e2e:server -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
