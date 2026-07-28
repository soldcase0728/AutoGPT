import { expect, test } from "@playwright/test";
import { fillBookingForm, signIn, slot, USERS } from "./helpers";

test.describe("head coach quick-book", () => {
  /**
   * Acceptance criterion 1, in a browser: one pass through the form, confirmed
   * on submit, with no approval, contract or payment step in the way.
   */
  test("books an in-season practice and it confirms immediately", async ({ page }, testInfo) => {
    await signIn(page, USERS.headCoach);
    await page.goto("/book");

    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Rakoczy Gymnasium — Court 1",
      title: "E2E boys practice",
      ...slot(testInfo, 0),
    });

    await page.getByRole("button", { name: "Request booking" }).click();

    await expect(page.getByText("Confirmed. It is on the facility calendar now.")).toBeVisible();
    await page.getByRole("link", { name: "View booking" }).click();

    await expect(page.getByRole("heading", { name: "E2E boys practice" })).toBeVisible();
    // Nothing was demanded of them.
    await expect(page.getByText("No documents required")).toBeVisible();
  });

  /**
   * Acceptance criterion 2: the same coach, same gym, paid activity. Role buys
   * nothing; the activity type decides.
   */
  test("is gated when the same coach books paid private instruction", async ({ page }, testInfo) => {
    await signIn(page, USERS.headCoach);
    await page.goto("/book");

    await page
      .getByLabel("Activity type")
      .selectOption({ label: "Private lessons / personal training" });

    // The consequence is stated before they fill anything in.
    await expect(page.getByText("Paid instruction is billable, whoever is asking")).toBeVisible();

    await fillBookingForm(page, {
      activity: "Private lessons / personal training",
      space: "Rakoczy Gymnasium — Court 1",
      title: "E2E Saturday clinic",
      ...slot(testInfo, 1),
    });
    await page.getByRole("button", { name: "Request booking" }).click();

    await expect(page.getByText(/Submitted for approval/)).toBeVisible();

    await page.getByRole("link", { name: "View booking" }).click();
    await expect(page.getByText("Pending approval").first()).toBeVisible();

    // Every gate is now visible on the booking.
    await expect(page.getByText("Facility Use Agreement")).toBeVisible();
    await expect(page.getByText("Liability Waiver & Release")).toBeVisible();
    await expect(page.getByText("Certificate of Insurance", { exact: true })).toBeVisible();
    // And it is billed, despite the requester being internal staff.
    await expect(page.getByText(/Invoice INV-/)).toBeVisible();
  });

  test("holds the slot while approval is pending", async ({ page }, testInfo) => {
    await signIn(page, USERS.headCoach);
    await page.goto("/book");

    await fillBookingForm(page, {
      activity: "Private lessons / personal training",
      space: "Rakoczy Gymnasium — Court 2",
      title: "E2E held slot",
      ...slot(testInfo, 2),
    });
    await page.getByRole("button", { name: "Request booking" }).click();
    await page.getByRole("link", { name: "View booking" }).click();

    await expect(page.getByText("This slot is held, not confirmed")).toBeVisible();
  });

  /** The conflict is reported to the person, not just rejected by the database. */
  test("refuses a clashing booking with a readable explanation", async ({ page }, testInfo) => {
    // Both attempts ask for the same slot on purpose.
    const contested = slot(testInfo, 3);

    await signIn(page, USERS.headCoach);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Dombrowski Fieldhouse — Court A",
      title: "E2E first claim",
      ...contested,
    });
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByText("Confirmed. It is on the facility calendar now.")).toBeVisible();

    // A different coach wants the same court at the same time.
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, USERS.otherCoach);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Dombrowski Fieldhouse — Court A",
      title: "E2E second claim",
      ...contested,
    });
    await page.getByRole("button", { name: "Request booking" }).click();

    await expect(page.getByText("That request did not go through")).toBeVisible();
    await expect(page.getByText(/already held by/)).toBeVisible();
  });

  /**
   * Acceptance criterion 5 through the UI: the full floor and its courts are
   * the same physical space, even though they are different rows.
   */
  test("booking the full floor blocks a court inside it", async ({ page }, testInfo) => {
    const contested = slot(testInfo, 4);

    await signIn(page, USERS.headCoach);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Dombrowski Fieldhouse — Full floor",
      title: "E2E full floor",
      ...contested,
    });
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByText("Confirmed. It is on the facility calendar now.")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, USERS.otherCoach);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Dombrowski Fieldhouse — Court B",
      title: "E2E court inside the floor",
      ...contested,
    });
    await page.getByRole("button", { name: "Request booking" }).click();

    await expect(page.getByText("That request did not go through")).toBeVisible();
  });
});

test.describe("assistant coach", () => {
  /** Routine practice goes to the head coach, not into the admin queue. */
  test("request routes to the head coach for a one-click OK", async ({ page }, testInfo) => {
    await signIn(page, USERS.assistant);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Rakoczy Gymnasium — Auxiliary / upper",
      title: "E2E JV practice",
      ...slot(testInfo, 5),
    });
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByText(/Submitted for approval/)).toBeVisible();

    // The head coach sees it and approves.
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, USERS.headCoach);
    await page.goto("/admin/approvals");

    await expect(page.getByText("E2E JV practice")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).first().click();

    await expect(page.getByText("E2E JV practice")).toBeHidden();
  });
});
