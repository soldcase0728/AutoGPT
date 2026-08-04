import { expect, test, type Page } from "@playwright/test";
import { signIn, signOut, USERS } from "./helpers";

/**
 * Coach-requested standing blocks, end to end: the head coach asks for the
 * season's recurring practice time from their team page, the request waits in
 * the athletic office's approval queue, and the decision lands back on the
 * coach's page.
 *
 * Each browser project runs against the same database, so each claims its own
 * spaces -- the approved and denied blocks from one project's run persist into
 * the next.
 */

function spacesFor(projectName: string) {
  return projectName === "mobile"
    ? { approve: "Rakoczy Gymnasium — Court 1", deny: "Dombrowski Fieldhouse — Court A" }
    : { approve: "Rakoczy Gymnasium — Full court", deny: "Rakoczy Gymnasium — Court 2" };
}

async function submitRequest(page: Page, space: string, note: string): Promise<void> {
  await page.goto("/my-team");
  await page.getByLabel("Space").selectOption({ label: space });
  await page.getByLabel("Note for the athletic office").fill(note);
  await page.getByRole("button", { name: "Request standing time" }).click();
  await expect(page.getByText("Requested", { exact: true })).toBeVisible();
}

/** The approval-queue card for one request, found by the space it names. */
function requestCard(page: Page, spaceLabel: string) {
  const [facility, subSpace] = spaceLabel.split(" — ");
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: `${facility}, ${subSpace}` }) });
}

test.describe("coach-requested standing time", () => {
  test("a request travels from the coach to the queue to an approval", async ({
    page,
  }, testInfo) => {
    const space = spacesFor(testInfo.project.name).approve;

    await signIn(page, USERS.headCoach);
    await submitRequest(page, space, "Varsity practice through the district tournament.");
    await expect(page.getByText("Awaiting review").first()).toBeVisible();
    await signOut(page);

    // The athletic director finds it in the ordinary approval queue.
    await signIn(page, USERS.ad);
    await page.goto("/admin/approvals");
    const card = requestCard(page, space);
    await expect(card.getByText("Awaiting review")).toBeVisible();
    await expect(card.getByText("Varsity practice through the district tournament.")).toBeVisible();
    await card.getByRole("button", { name: "Approve" }).click();

    // Decided, so it leaves the queue.
    await expect(requestCard(page, space)).toHaveCount(0);
    await signOut(page);

    // The coach sees the outcome without being told to look.
    await signIn(page, USERS.headCoach);
    await page.goto("/my-team");
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  });

  test("a denial reaches the coach with the reason, verbatim", async ({ page }, testInfo) => {
    const space = spacesFor(testInfo.project.name).deny;
    const reason = `That window is committed to volleyball (${testInfo.project.name}).`;

    await signIn(page, USERS.headCoach);
    await submitRequest(page, space, "Second slot for JV.");
    await signOut(page);

    await signIn(page, USERS.ad);
    await page.goto("/admin/approvals");
    const card = requestCard(page, space);
    await card.getByRole("button", { name: "Deny…" }).click();
    await card.getByLabel("Reason for denial (sent to the coach)").fill(reason);
    await card.getByRole("button", { name: "Confirm denial" }).click();
    await expect(requestCard(page, space)).toHaveCount(0);
    await signOut(page);

    await signIn(page, USERS.headCoach);
    await page.goto("/my-team");
    await expect(page.getByText("Not approved").first()).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
  });
});
