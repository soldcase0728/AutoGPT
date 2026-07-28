import { expect, type Page } from "@playwright/test";

export const SEED_PASSWORD = "ChangeMe123456";

export const USERS = {
  ad: "ad@olsm.edu",
  headCoach: "bball.head@olsm.edu",
  assistant: "bball.assistant@olsm.edu",
  otherCoach: "gbball.head@olsm.edu",
  facilities: "facilities@olsm.edu",
} as const;

/** Sign in through the real form, so the session cookie is minted normally. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(calendar|portal)/);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/);
}

/**
 * A future Tuesday, so a booking always lands on a weekday inside published
 * hours rather than on a weekend when facilities may be closed.
 */
export function futureTuesday(weeksAhead = 3): string {
  const d = new Date(Date.now() + weeksAhead * 7 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A slot no other test will touch.
 *
 * Two things make naive slot picking break, and both are real behaviour rather
 * than test flakiness:
 *
 *   1. Facilities pad bookings with a setup/teardown buffer, so adjacent hours
 *      genuinely conflict. Slots are therefore spaced two hours apart.
 *   2. Every spec runs once per browser project against the same database, so
 *      the second project would collide with the first project's bookings.
 *      Each project gets its own block of weeks.
 *
 * Tests that *want* a collision simply ask for the same index twice.
 */
export function slot(
  testInfo: { project: { name: string } },
  index: number,
): { date: string; start: string; end: string } {
  const projectOffset = testInfo.project.name === "mobile" ? 26 : 0;
  const weeksAhead = 3 + projectOffset + Math.floor(index / 6);
  const hour = 8 + (index % 6) * 2; // 08, 10, 12, 14, 16, 18

  return {
    date: futureTuesday(weeksAhead),
    start: `${String(hour).padStart(2, "0")}:00`,
    end: `${String(hour + 1).padStart(2, "0")}:00`,
  };
}

export async function fillBookingForm(
  page: Page,
  opts: {
    activity: string;
    space: string;
    title: string;
    date: string;
    start: string;
    end: string;
  },
): Promise<void> {
  await page.getByLabel("Activity type").selectOption({ label: opts.activity });
  await page.getByLabel("Space").selectOption({ label: opts.space });
  await page.getByLabel("Title").fill(opts.title);
  await page.getByLabel("Date").fill(opts.date);
  await page.getByLabel("Start").fill(opts.start);
  await page.getByLabel("End").fill(opts.end);
}

export async function expectVisibleText(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}
