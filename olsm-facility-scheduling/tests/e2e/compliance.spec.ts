import { expect, test } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * The liability gates, seen the way the people subject to them see them.
 */

test.describe("annual coach agreement", () => {
  /**
   * Acceptance criterion 3. The block is shown before the coach fills anything
   * in, with the fix one click away -- an error after a completed form would
   * teach people to route around the system.
   */
  test("blocks booking and offers the signing link", async ({ page, request }) => {
    // Strip this coach's agreement through the test-only fixture endpoint.
    await request.post("/api/test/revoke-agreement", {
      data: { email: "football.head@olsm.edu" },
      headers: { "x-e2e-token": process.env.E2E_TOKEN ?? "e2e-local-token" },
    });

    await signIn(page, "football.head@olsm.edu");
    await page.goto("/book");

    await expect(
      page.getByText("Your Annual Coach Agreement is not on file", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Sign your Annual Coach Agreement/ })).toBeVisible();

    // The form is not merely disabled; it is not offered at all.
    await expect(page.getByRole("button", { name: "Request booking" })).toHaveCount(0);
  });

  test("shows a current agreement as satisfied", async ({ page }) => {
    await signIn(page, USERS.headCoach);
    await page.goto("/my-documents");
    await expect(page.getByText("On file and current")).toBeVisible();
  });
});

test.describe("participant waivers", () => {
  /**
   * The point of the feature: someone with no account, standing in a gym,
   * signing for themselves and for a child.
   */
  test("a participant signs through the public link with no account", async ({ page, request }) => {
    const created = await request.post("/api/test/waiver-booking", {
      headers: { "x-e2e-token": process.env.E2E_TOKEN ?? "e2e-local-token" },
    });
    expect(created.ok()).toBeTruthy();
    const { token, title } = (await created.json()) as { token: string; title: string };

    await page.goto(`/waiver/${token}`);

    await expect(page.getByRole("heading", { name: "Liability waiver and release" })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();

    await page.getByLabel("Participant's full name").fill("Wendy Walk-in");
    await page.getByLabel("Email address").fill("wendy@example.com");
    await page.getByLabel(/I have read the release/).check();
    await page.getByRole("button", { name: "Sign release" }).click();

    await expect(page.getByText("Signed — thank you")).toBeVisible();
    await expect(page.getByText("Wendy Walk-in is covered for this activity.")).toBeVisible();
  });

  test("a minor requires a guardian to sign", async ({ page, request }) => {
    const created = await request.post("/api/test/waiver-booking", {
      headers: { "x-e2e-token": process.env.E2E_TOKEN ?? "e2e-local-token" },
    });
    const { token } = (await created.json()) as { token: string };

    await page.goto(`/waiver/${token}`);
    await page.getByLabel("Participant's full name").fill("Sam Smith");
    await page.getByLabel("This participant is under 18").check();

    // The guardian fields appear only once they are needed.
    await expect(
      page.getByText("A parent or legal guardian must sign for a participant under 18."),
    ).toBeVisible();

    await page.getByLabel("Parent or guardian's full name").fill("Jane Smith");
    await page.getByLabel(/I have read the release/).check();
    await page.getByRole("button", { name: "Sign release" }).click();

    await expect(page.getByText("Signed — thank you")).toBeVisible();
  });

  test("the shared link is unguessable and unknown tokens 404", async ({ page }) => {
    const response = await page.goto("/waiver/definitely-not-a-real-token");
    expect(response?.status()).toBe(404);
  });
});

test.describe("role boundaries", () => {
  test("a coach following an admin link is told why, not shown an error", async ({ page }) => {
    await signIn(page, USERS.headCoach);
    await page.goto("/admin/rules");

    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByRole("heading", { name: "Not permitted" })).toBeVisible();
  });

  test("facilities staff get the setup board, not the booking form", async ({ page }) => {
    await signIn(page, USERS.facilities);
    await expect(page).toHaveURL(/\/(custodial|calendar)/);

    await page.goto("/custodial");
    await expect(page.getByRole("heading", { name: "Daily setup board" })).toBeVisible();
  });

  test("signed-out visitors see the public directory, not the calendar", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
