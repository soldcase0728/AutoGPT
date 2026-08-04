import { expect, test } from "@playwright/test";
import { USERS, signIn } from "./helpers";

/**
 * Regressions for defects a UI audit found. Each one blocked a real person from
 * finishing a real task, and none was visible from the server side.
 */

test("a coach whose agreement expired can start a new one", async ({ page, request }) => {
  // The gate is shown the moment the agreement lapses; before this fix the page
  // that was supposed to clear it offered nothing to click, because the button
  // only appeared for a coach who had never had an agreement at all.
  await request.post("/api/test/revoke-agreement", {
    data: { email: "football.head@olsm.edu" },
    headers: { "x-e2e-token": process.env.E2E_TOKEN ?? "e2e-local-token" },
  });

  await signIn(page, "football.head@olsm.edu");
  await page.goto("/my-documents");

  const start = page.getByRole("button", { name: /Annual Coach Agreement|this year's agreement/i });
  await expect(start).toBeVisible();
  await start.click();

  // A signable document now exists, so the coach has a way out of the block.
  await expect(page.getByRole("link", { name: /sign/i }).first()).toBeVisible();
});

test("a head coach can reach the queue they are the named approver for", async ({ page }) => {
  // decideApproval always accepted them and the page always scoped correctly;
  // the navigation simply had no link, so an assistant's request sat unseen.
  await signIn(page, USERS.headCoach);
  await expect(page.getByRole("link", { name: "Approvals" })).toBeVisible();

  await page.getByRole("link", { name: "Approvals" }).click();
  await expect(page).toHaveURL(/\/admin\/approvals/);
  await expect(page.getByRole("heading", { name: /approval/i }).first()).toBeVisible();
});

test("an assistant coach is still kept out of the admin tools", async ({ page }) => {
  // The nav gained a link for head coaches. It must not have gained one for
  // everybody: this is the check that the widening was narrow.
  await signIn(page, USERS.assistant);
  await expect(page.getByRole("link", { name: "Approvals" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

  await page.goto("/admin/rules");
  await expect(page).toHaveURL(/\/forbidden/);
});
