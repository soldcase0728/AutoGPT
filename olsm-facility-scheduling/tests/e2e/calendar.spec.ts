import { expect, test } from "@playwright/test";
import { fillBookingForm, futureTuesday, signIn, slot, USERS } from "./helpers";

test.describe("calendar", () => {
  test("switches between day, week, month and agenda", async ({ page }) => {
    await signIn(page, USERS.headCoach);
    await page.goto("/calendar");

    // Week is the default.
    await expect(page.getByRole("link", { name: "week" })).toHaveAttribute("aria-current", "page");

    await page.getByRole("link", { name: "day", exact: true }).click();
    await expect(page.getByText("Columns are the bookable spaces in this facility.")).toBeVisible();

    await page.getByRole("link", { name: "month", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Month" })).toBeVisible();

    await page.getByRole("link", { name: "agenda", exact: true }).click();
    await expect(page.getByText(/booking/).first()).toBeVisible();
  });

  test("shows a booking on the grid after it is made", async ({ page }, testInfo) => {
    const booking = slot(testInfo, 6);

    await signIn(page, USERS.headCoach);
    await page.goto("/book");
    await fillBookingForm(page, {
      activity: "In-season team practice",
      space: "Rakoczy Gymnasium — Court 1",
      title: "E2E calendar practice",
      ...booking,
    });
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByText("Confirmed. It is on the facility calendar now.")).toBeVisible();

    await page.goto(`/calendar?view=agenda&from=${booking.date}`);
    await expect(page.getByText("E2E calendar practice").first()).toBeVisible();
  });

  /**
   * Drag-to-create is a convenience over the booking form, never a way around
   * it: the drag only prefills, and every check still runs on submit.
   */
  test("dragging empty time opens the booking form prefilled", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Pointer drag is a desktop affordance.");

    const date = futureTuesday(testInfo.project.name === "mobile" ? 40 : 14);
    await signIn(page, USERS.headCoach);
    await page.goto(`/calendar?view=day&from=${date}`);

    await expect(page.getByText(/Drag across empty time/)).toBeVisible();

    // Drag down the first space column. The grid is taller than the viewport,
    // so scroll to it and stay near the top of the column -- a drag to a point
    // below the fold never reaches the element.
    const column = page.locator(".cursor-crosshair").first();
    await column.scrollIntoViewIfNeeded();
    const box = await column.boundingBox();
    expect(box).not.toBeNull();

    const x = box!.x + box!.width / 2;
    await page.mouse.move(x, box!.y + 30);
    await page.mouse.down();
    await page.mouse.move(x, box!.y + 130, { steps: 10 });
    await page.mouse.up();

    await page.waitForURL(/\/book\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("date")).toBe(date);
    expect(url.searchParams.get("start")).toMatch(/^\d{2}:\d{2}$/);
    expect(url.searchParams.get("subSpace")).toBeTruthy();

    // And the form arrives already filled in.
    await expect(page.getByLabel("Date")).toHaveValue(date);
    await expect(page.getByLabel("Start")).toHaveValue(url.searchParams.get("start")!);
  });

  test("read-only roles cannot drag to create", async ({ page }) => {
    await signIn(page, USERS.facilities);
    await page.goto("/calendar?view=day");
    await expect(page.getByText(/Drag across empty time/)).toHaveCount(0);
  });
});

test.describe("public pages", () => {
  test("the facility directory is readable signed out", async ({ page }) => {
    await page.goto("/facilities");
    await expect(page.getByRole("heading", { name: "Athletic facilities" })).toBeVisible();
    await expect(page.getByText("Rakoczy Gymnasium")).toBeVisible();

    await page.getByRole("link", { name: "Rakoczy Gymnasium" }).first().click();
    await expect(page.getByRole("heading", { name: "Rakoczy Gymnasium" })).toBeVisible();
    await expect(page.getByText("Published hours")).toBeVisible();
  });

  /**
   * A space the school does not hire out must not advertise a price or offer a
   * request button. The server already refuses such a booking; this covers the
   * public page, which was quoting an hourly rate beside a button that led
   * straight into a rejection.
   */
  /** Four doors, not a redirect straight into the directory. */
  test("the home page offers a path per audience", async ({ page }) => {
    await page.goto("/");
    for (const path of [
      "Schedule a team practice",
      "Rent a facility",
      "My reservations",
      "Administration",
    ]) {
      await expect(page.getByRole("link", { name: new RegExp(path) }).first()).toBeVisible();
    }
  });

  /** Filter state lives in the URL, so a filtered view survives a reload. */
  test("the directory filters, and says so when nothing matches", async ({ page }) => {
    // Scoped to the results list: the filter dropdown carries these same
    // words as option labels, and an <option> is not visible.
    const results = page.getByRole("list").filter({ has: page.getByRole("listitem") }).last();

    await page.goto("/facilities");
    const all = await results.getByRole("listitem").count();
    expect(all).toBeGreaterThan(1);

    await page.goto("/facilities?access=school");
    await expect(results.getByText("School use only").first()).toBeVisible();
    await expect(results.getByText("Available to outside groups")).toHaveCount(0);
    expect(await results.getByRole("listitem").count()).toBeLessThan(all);

    await page.goto("/facilities?q=zzzznomatch");
    await expect(page.getByText("No facilities match those filters")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).first().click();
    await expect(page).toHaveURL(/\/facilities$/);
    expect(await results.getByRole("listitem").count()).toBe(all);
  });

  test("a school-only facility shows no rate and no request button", async ({ page }) => {
    await page.goto("/facilities/crew-house");

    await expect(page.getByText(/Available only to authorized OLSM teams/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Request this facility" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to book" })).toBeVisible();
    // No money anywhere on the page.
    await expect(page.locator("body")).not.toContainText("$");

    // A facility that is hired out still shows both.
    await page.goto("/facilities/rakoczy-gymnasium");
    await expect(page.getByRole("link", { name: "Request this facility" })).toBeVisible();
    await expect(page.getByText("per hour")).toBeVisible();
  });

  /**
   * The pilot boundary: nobody holds a slot without an account the school
   * issued. The form is not merely hidden -- the server refuses the post -- but
   * this covers the part a person sees.
   */
  test("a signed-out visitor is asked to sign in rather than shown a request form", async ({
    page,
  }) => {
    await page.goto("/request");

    await expect(page.getByRole("heading", { name: "Sign in to request a facility" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(page.getByText(/set up with an account by the athletic office/)).toBeVisible();

    // None of the booking controls are present to be submitted.
    await expect(page.getByLabel("Facility and space")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Submit request/ })).toHaveCount(0);
  });

  // Anonymous requests are off for the pilot (ALLOW_ANONYMOUS_REQUESTS). The
  // path still exists and this covers it; re-enable alongside the verification,
  // single-use token and rate-limit work that path needs before facing the
  // public.
  test.skip("an outside group can start a request with no account", async ({ page }) => {
    await page.goto("/request");
    await expect(page.getByRole("heading", { name: "Request a facility" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "How a request becomes a booking" }),
    ).toBeVisible();

    // Each button names the step it leads to, rather than saying "Next", so the
    // label alone tells the reader what the click does.
    await page.getByRole("button", { name: "Choose a space" }).click();
    await expect(page.getByLabel("Facility and space")).toBeVisible();

    await page.getByRole("button", { name: "Describe the event" }).click();
    await expect(page.getByLabel("Type of use")).toBeVisible();

    await page.getByRole("button", { name: "Add your contact details" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();

    // The last action says what submitting actually causes.
    await expect(
      page.getByRole("button", { name: "Submit request and hold this time" }),
    ).toBeVisible();
  });
});
