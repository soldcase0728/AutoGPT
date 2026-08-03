import { expect, test } from "@playwright/test";
import { SEED_PASSWORD, USERS, signIn, signOut } from "./helpers";

/**
 * Getting a new person into the system.
 *
 * This is the path that did not exist: sign-in through Microsoft or Google
 * links to an account rather than creating one, so without this an outside club
 * -- or a coach hired mid-season -- could not get in at all.
 *
 * The e2e environment has no email provider, so the invitation link comes back
 * on screen for the administrator to pass on. That is deliberate behaviour, and
 * it is also what lets this test follow the link the invitee would receive.
 */

const NEW_PASSWORD = "InvitedPass123";

/** One address per browser project: both run against the same database. */
function inviteeEmail(project: string): string {
  return `e2e.invited.${project}@example.test`;
}

test("an administrator adds an outside group, who set a password and sign in", async ({
  page,
}, testInfo) => {
  const email = inviteeEmail(testInfo.project.name);

  await signIn(page, USERS.ad);
  await page.goto("/admin/users");

  await page.getByLabel("Name").fill("Lakeshore Volleyball");
  await page.getByLabel("Email address").fill(email);
  // Scoped by id: every existing person on this page also has a Role select.
  await page.locator("#new-user-role").selectOption({ label: "External requester" });
  await page.getByLabel("Organization (optional)").fill("Lakeshore Volleyball Club");
  await page.getByRole("button", { name: "Add and send sign-in link" }).click();

  const notice = page.getByText(/Give them this link yourself/);
  await expect(notice).toBeVisible();

  const link = (await notice.innerText()).match(/\/set-password\/[A-Za-z0-9_-]+/)?.[0];
  expect(link, "the notice should carry a usable sign-in link").toBeTruthy();

  await signOut(page);

  // Opening the page must not spend the token. A link scanner fetches every URL
  // in inbound mail before the recipient does, so loading it twice has to leave
  // it usable -- otherwise every invitation arrives already burnt.
  await page.goto(link!);
  await expect(page.getByRole("heading", { name: /Welcome, Lakeshore/ })).toBeVisible();
  await page.goto(link!);
  await expect(page.getByRole("heading", { name: /Welcome, Lakeshore/ })).toBeVisible();

  await page.getByLabel("Choose a password").fill(NEW_PASSWORD);
  await page.getByLabel("Type it again").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();

  // An external requester lands in the portal, already signed in.
  await page.waitForURL(/\/portal/);
  await signOut(page);

  // The link is spent now.
  await page.goto(link!);
  await expect(page.getByText(/already been used/)).toBeVisible();

  // And the password they chose works.
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/portal/);
});

test("a duplicate address is refused, and the correction costs one edit", async ({ page }) => {
  // Uses a seeded address so this does not depend on another test running
  // first. A second account on one address splits somebody's bookings,
  // documents and invoices across two records.
  //
  // The second assertion is the one that is easy to lose: React clears an
  // uncontrolled field once the action settles, so without the form holding its
  // own values a rejected submission throws away the name that was typed along
  // with the address that was wrong.
  await signIn(page, USERS.ad);
  await page.goto("/admin/users");

  await page.getByLabel("Name").fill("Duplicate Attempt");
  await page.getByLabel("Email address").fill(USERS.headCoach);
  await page.getByRole("button", { name: "Add and send sign-in link" }).click();

  await expect(page.getByText(/already has an account with that address/)).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Duplicate Attempt");
  await expect(page.getByLabel("Email address")).toHaveValue(USERS.headCoach);
});

test("the athletic office can add people but not change roles", async ({ page }) => {
  // The copy on the sign-in page tells outside groups the athletic office will
  // set them up, so the athletic office has to be able to. Moving authority
  // around stays with the director.
  await signIn(page, USERS.athleticOffice);
  await page.goto("/admin/users");

  await expect(page.getByRole("heading", { name: "Add a person" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add and send sign-in link/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);

  // And they cannot hand out a role above their own.
  const roles = await page.locator("#new-user-role option").allInnerTexts();
  expect(roles.join(" ")).not.toContain("Athletic Director");
});
