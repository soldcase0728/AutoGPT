import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Capture the product for a visual walkthrough.
 *
 * Signs in through the real form and screenshots each surface as a JPEG, small
 * enough to inline into a single self-contained page.
 */

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3300";
const OUT = "screenshots";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const SHOTS = [
  { name: "calendar-week", as: "ad@olsm.edu", path: "__WEEK__", full: true, height: 1500 },
  { name: "calendar-day", as: "ad@olsm.edu", path: "__DAY__", full: true, height: 1500 },
  { name: "quick-book", as: "bball.head@olsm.edu", path: "/book", full: true },
  { name: "approvals", as: "ad@olsm.edu", path: "/admin/approvals", full: true },
  { name: "booking-detail", as: "bball.head@olsm.edu", path: "__CLINIC__", full: true },
  { name: "waiver", as: null, path: "__WAIVER__", full: true },
  { name: "custodial", as: "facilities@olsm.edu", path: "/custodial", full: false },
  { name: "reports", as: "ad@olsm.edu", path: "/admin/reports", full: false },
  { name: "rules", as: "ad@olsm.edu", path: "/admin/rules", full: false },
  { name: "facilities-public", as: null, path: "/facilities", full: false },
];

async function signIn(page, email) {
  // Already-signed-in visitors are redirected away from /sign-in, so drop the
  // session before switching user.
  await page.context().clearCookies();
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("ChangeMe123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(calendar|portal|custodial|admin)/, { timeout: 20000 });
}

const main = async () => {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: existsSync(CHROME) ? CHROME : undefined,
  });

  // Resolve the dynamic URLs from the demo data.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const clinic = await prisma.booking.findFirst({
    where: { title: "Saturday shooting clinic" },
  });
  const rakoczy = await prisma.facility.findFirst({ where: { slug: "rakoczy-gymnasium" } });
  // Aim the calendar at the week the demo data actually fills, and at a
  // facility with something in it -- an empty grid shows nothing useful.
  const busiest = await prisma.booking.findFirst({
    where: { subSpace: { facilityId: rakoczy?.id } },
    orderBy: { startAt: "asc" },
  });
  const weekISO = busiest
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(busiest.startAt)
    : "";
  await prisma.$disconnect();

  const resolve = (path) =>
    path
      .replace("__CLINIC__", `/portal/bookings/${clinic?.id ?? ""}`)
      .replace("__WAIVER__", `/waiver/${clinic?.waiverToken ?? ""}`)
      .replace("__WEEK__", `/calendar?view=week&from=${weekISO}`)
      .replace("__DAY__", `/calendar?view=day&from=${weekISO}&facility=${rakoczy?.id ?? ""}`);

  let signedInAs = null;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await context.newPage();

  for (const shot of SHOTS) {
    if (shot.as && signedInAs !== shot.as) {
      await signIn(page, shot.as);
      signedInAs = shot.as;
    }
    if (!shot.as && signedInAs) {
      await context.clearCookies();
      signedInAs = null;
    }

    await page.goto(`${BASE}${resolve(shot.path)}`, { waitUntil: "networkidle" });
    // The time grid renders a full day; scroll to the part of it people care
    // about rather than screenshotting an empty morning.
    if (shot.scroll) await page.evaluate((y) => window.scrollTo(0, y), shot.scroll);
    // A taller viewport keeps the page header in frame alongside a full day of
    // the time grid, instead of cropping one or the other.
    if (shot.height) {
      await page.setViewportSize({ width: 1280, height: shot.height });
      await page.waitForTimeout(250);
    } else {
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page.waitForTimeout(400);

    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 68,
      fullPage: shot.full,
    });
    await writeFile(`${OUT}/${shot.name}.jpg`, buffer);
    console.log(`${shot.name}: ${(buffer.length / 1024).toFixed(0)} KB`);
  }

  await browser.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
