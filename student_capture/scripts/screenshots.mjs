/**
 * Renders every preview screen and writes a PNG per screen, failing on a
 * non-200, an empty body, or a console error. Catches the class of bug that
 * `next build` and `tsc` both wave through — a server component handing a
 * client component something that cannot serialise, for one.
 *
 *   pnpm dev &                       # or any running dev server
 *   node scripts/screenshots.mjs .tmp-shots [http://127.0.0.1:3000]
 *
 * Needs Playwright available; it is deliberately not a dependency of this app.
 * With a global install, prefix the command with NODE_PATH=$(npm root -g).
 */

import { createRequire } from "node:module";

// `require` honours NODE_PATH, so a global Playwright install works without
// making it a dependency of this app:
//   NODE_PATH=$(npm root -g) node scripts/screenshots.mjs
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    "Playwright not found. Either install it here (pnpm add -D playwright) or\n" +
      "use a global one: NODE_PATH=$(npm root -g) node scripts/screenshots.mjs",
  );
  process.exit(2);
}

const OUT = process.argv[2] ?? ".tmp-shots";
const BASE = process.argv[3] ?? "http://127.0.0.1:3000";

const PHONE = { width: 402, height: 874, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { width: 1440, height: 940, deviceScaleFactor: 2 };

const SHOTS = [
  ["today", PHONE, "01-today", null],
  ["capture", PHONE, "02-capture", null],
  ["consent", PHONE, "03-consent", null],
  ["submissions", PHONE, "04-submissions", null],
  ["today-done", PHONE, "05-today-done", null],
  ["review", DESK, "06-review", null],
  [
    "review",
    DESK,
    "07-review-blocked",
    async (page) => {
      // The second row is the minor with no parental release on file.
      await page.getByRole("button", { name: /Jo Mercer/ }).click();
      await page.waitForTimeout(400);
    },
  ],
];

await (await import("node:fs/promises")).mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const [screen, viewport, name, drive] of SHOTS) {
  const context = await browser.newContext({ viewport, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const res = await page.goto(`${BASE}/preview/${screen}`, { waitUntil: "networkidle" });
  if (!res || res.status() !== 200) problems.push(`${name}: HTTP ${res && res.status()}`);

  // The dev-server badge is not part of the app.
  await page.addStyleTag({
    content: "nextjs-portal,[data-next-badge-root]{display:none!important}",
  });

  if (drive) {
    try {
      await drive(page);
    } catch (e) {
      problems.push(`${name}: drive failed — ${e.message.split("\n")[0]}`);
    }
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

  const text = (await page.locator("body").innerText()).trim();
  if (text.length < 40) problems.push(`${name}: page looks empty`);
  const real = errors.filter((e) => !/favicon|React DevTools/i.test(e));
  if (real.length) problems.push(`${name}: ${real.slice(0, 2).join(" | ")}`);

  console.log(`  ${name.padEnd(20)} ${String(text.length).padStart(5)} chars`);
  await context.close();
}

await browser.close();

if (problems.length) {
  console.error("\nPROBLEMS:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
console.log(`\nall screens rendered clean -> ${OUT}/`);
