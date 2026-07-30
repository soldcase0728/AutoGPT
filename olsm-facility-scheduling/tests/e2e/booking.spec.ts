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

    // The progress card says which of those is being waited on, so nobody has
    // to telephone the athletic office to find out.
    const progress = page.locator("aside").getByRole("list").first();
    await expect(progress.getByText("Request submitted")).toBeVisible();
    await expect(progress.getByText("School approval")).toBeVisible();
    await expect(progress.getByText("Payment")).toBeVisible();
    await expect(page.getByText("Waiting on: School approval.")).toBeVisible();
  });

  /**
   * The same card on a booking that owes nothing. A routine practice should not
   * be dressed up with four greyed-out compliance steps it never had.
   */
  test("a routine practice shows no paperwork it does not owe", async ({ page }, testInfo) => {
    await signIn(page, USERS.headCoach);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Rakoczy Gymnasium — Auxiliary / upper",
      title: "E2E plain practice",
      ...slot(testInfo, 18),
    });
    await page.getByRole("button", { name: "Request booking" }).click();
    await page.getByRole("link", { name: "View booking" }).click();

    const progress = page.locator("aside").getByRole("list").first();
    await expect(progress.getByText("Request submitted")).toBeVisible();
    await expect(progress.getByText("Confirmed")).toBeVisible();
    await expect(progress.getByText("Agreement")).toHaveCount(0);
    await expect(progress.getByText("Insurance")).toHaveCount(0);
    await expect(progress.getByText("Payment")).toHaveCount(0);
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

  /**
   * Repeating an earlier booking: one click from the Book again list should
   * carry the space, activity, title and time across, leaving only the date to
   * think about. The repeat is filed against a fresh slot here so the two
   * browser projects do not contend for the same next-weekday slot.
   */
  test("repeats an earlier practice from one click", async ({ page }, testInfo) => {
    const original = slot(testInfo, 8);

    await signIn(page, USERS.headCoach);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Rakoczy Gymnasium — Court 2",
      title: "E2E repeatable practice",
      ...original,
    });
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByText("Confirmed. It is on the facility calendar now.")).toBeVisible();

    // Land on /book fresh, so the list reflects the booking just made.
    await page.goto("/book");
    await page.reload();
    await page.getByRole("link", { name: /E2E repeatable practice/ }).first().click();

    // Everything except the date came across.
    await expect(page.getByLabel("Title")).toHaveValue("E2E repeatable practice");
    await expect(page.getByLabel("Start")).toHaveValue(original.start);
    await expect(page.getByLabel("End")).toHaveValue(original.end);
    await expect(page.getByLabel("Activity type")).toHaveValue("TEAM_PRACTICE");
    const space = await page.getByLabel("Space").inputValue();
    expect(space).not.toBe("");

    // The suggested date is the next matching weekday, never one in the past.
    const suggested = await page.getByLabel("Date").inputValue();
    expect(suggested >= new Date().toISOString().slice(0, 10)).toBe(true);

    const repeat = slot(testInfo, 9);
    await page.getByLabel("Date").fill(repeat.date);
    await page.getByLabel("Start").fill(repeat.start);
    await page.getByLabel("End").fill(repeat.end);
    await page.getByRole("button", { name: "Request booking" }).click();

    await expect(page.getByText("Confirmed. It is on the facility calendar now.")).toBeVisible();
  });

  /** The conflict is reported to the person, not just rejected by the database. */
  test("refuses a clashing booking with a readable explanation", async ({ page }, testInfo) => {
    // Both attempts ask for the same slot on purpose.
    //
    // Index 12 rather than 3 so this test owns its whole week block. It ends by
    // accepting a suggested alternative, and suggestions move by one to three
    // hours -- inside the two-hour spacing `slot` uses -- so a lower index would
    // book a slot belonging to the next test along.
    const contested = slot(testInfo, 12);

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

    // A rejected booking must not throw away what was typed, and the form must
    // show the space it would actually submit -- React resets a form after an
    // action, which used to leave the select displaying a different one.
    await expect(page.getByLabel("Title")).toHaveValue("E2E second claim");
    const shownSpace = await page
      .locator("#subSpaceId")
      .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text);
    expect(shownSpace).toContain("Court A");

    // A clash is a choice, not a dead end: the server offers slots it checked
    // and would accept, and picking one fills the form in.
    await expect(page.getByText("These are free instead:")).toBeVisible();
    const suggestion = page.getByRole("button", { name: /Same (space|time)/ }).first();
    await expect(suggestion).toBeVisible();

    await suggestion.click();
    // Something about the slot must have moved.
    const movedTime = (await page.getByLabel("Start").inputValue()) !== contested.start;
    const movedDate = (await page.getByLabel("Date").inputValue()) !== contested.date;
    const movedSpace =
      (await page
        .locator("#subSpaceId")
        .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text)) !== shownSpace;
    expect(movedTime || movedDate || movedSpace).toBe(true);

    // And the slot it filled in is one the server actually accepts.
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByText("Confirmed. It is on the facility calendar now.")).toBeVisible();
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
