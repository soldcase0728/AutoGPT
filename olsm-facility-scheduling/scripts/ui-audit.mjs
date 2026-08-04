import { chromium, devices } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * UI and accessibility audit.
 *
 * Walks every surface as the person who actually uses it, at a desktop width
 * and on a phone, and reports what a machine can check: WCAG 2.2 AA violations
 * from axe-core, plus a screenshot of each so a human can judge the rest.
 *
 * Two things this deliberately does *not* do. It does not fail a build -- it is
 * a report, and a report that blocks people gets switched off. And it does not
 * claim a clean run means the interface is good: axe finds perhaps a third of
 * real accessibility problems, and none of the questions worth asking about
 * whether a coach can find the button.
 *
 *   node scripts/ui-audit.mjs                      # against a local server
 *   AUDIT_BASE_URL=https://… node scripts/ui-audit.mjs
 */

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:3400";
const OUT = process.env.AUDIT_OUT ?? "ui-audit";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "ChangeMe123456";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** Who sees what. A surface is audited once per role that can reach it. */
const SURFACES = [
  { path: "/", as: null, name: "home" },
  { path: "/facilities", as: null, name: "facility-directory" },
  { path: "/facilities/rakoczy-gymnasium", as: null, name: "facility-detail" },
  { path: "/sign-in", as: null, name: "sign-in" },
  { path: "/request", as: null, name: "request-signed-out" },
  { path: "/set-password/not-a-real-token", as: null, name: "set-password-expired" },

  { path: "/calendar", as: "bball.head@olsm.edu", name: "calendar-coach" },
  { path: "/book", as: "bball.head@olsm.edu", name: "quick-book" },
  { path: "/my-team", as: "bball.head@olsm.edu", name: "my-team" },
  { path: "/my-documents", as: "bball.head@olsm.edu", name: "my-documents" },
  { path: "/portal", as: "bball.head@olsm.edu", name: "portal" },

  { path: "/admin", as: "ad@olsm.edu", name: "admin-home" },
  { path: "/admin/approvals", as: "ad@olsm.edu", name: "approvals" },
  { path: "/admin/allocation", as: "ad@olsm.edu", name: "allocation" },
  { path: "/admin/users", as: "ad@olsm.edu", name: "people" },
  { path: "/admin/facilities", as: "ad@olsm.edu", name: "admin-facilities" },
  { path: "/admin/rates", as: "ad@olsm.edu", name: "rates" },
  { path: "/admin/rules", as: "ad@olsm.edu", name: "rules" },
  { path: "/admin/blackouts", as: "ad@olsm.edu", name: "blackouts" },
  { path: "/admin/reports", as: "ad@olsm.edu", name: "reports" },
  { path: "/admin/audit", as: "ad@olsm.edu", name: "audit-log" },

  { path: "/custodial", as: "facilities@olsm.edu", name: "setup-board" },
];

const VIEWPORTS = [
  { key: "desktop", opts: { viewport: { width: 1280, height: 900 } } },
  { key: "mobile", opts: { ...devices["Pixel 7"] } },
];

async function signIn(page, email) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  // A signed-in visitor is redirected away from /sign-in, so a form that is not
  // there means the session is already established.
  if (!(await page.getByLabel("Email address").count())) return;
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(calendar|portal|custodial|admin)/, { timeout: 15_000 });
}

/**
 * Contrast is reported separately from everything else.
 *
 * It is the rule most likely to fire in bulk from one bad token, and lumping
 * eighty instances of the same grey in with genuine structural faults buries
 * the faults. Same data, two piles.
 */
function summarise(results) {
  const rows = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    count: v.nodes.length,
    // Enough to find it, not so much that the report becomes a DOM dump.
    sample: v.nodes.slice(0, 3).map((n) => ({
      target: n.target.join(" "),
      snippet: n.html.slice(0, 200),
    })),
  }));
  return {
    contrast: rows.filter((r) => r.id.includes("contrast")),
    structural: rows.filter((r) => !r.id.includes("contrast")),
  };
}

async function main() {
  if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: existsSync(CHROME) ? CHROME : undefined,
  });

  const findings = [];
  let audited = 0;

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext(vp.opts);
    const page = await context.newPage();
    let signedInAs = null;

    for (const surface of SURFACES) {
      if (surface.as !== signedInAs) {
        if (surface.as === null) {
          await context.clearCookies();
        } else {
          await context.clearCookies();
          await signIn(page, surface.as);
        }
        signedInAs = surface.as;
      }

      const url = `${BASE}${surface.path}`;
      let status = "ok";
      try {
        // domcontentloaded, not networkidle: a page holding any long-lived
        // connection never goes idle, and the wait times out on a page that
        // rendered perfectly. Settle briefly afterwards so hydration lands
        // before axe reads the DOM.
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        if (response && response.status() >= 400) status = `http ${response.status()}`;
        await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(400);
      } catch (error) {
        status = `navigation failed: ${String(error).slice(0, 120)}`;
      }

      // Refuse to measure an unstyled page.
      //
      // A standalone build serves nothing from .next/static unless it was
      // copied in, and a run against a server missing its stylesheet reports
      // hundreds of target-size violations and phantom horizontal overflow --
      // every element collapsed to its intrinsic size. That is a broken
      // harness describing itself, and it reads exactly like a finding.
      const styled = await page.evaluate(() => {
        const sheets = [...document.styleSheets].length > 0;
        const body = getComputedStyle(document.body);
        return sheets && body.margin !== "8px";
      });
      if (!styled) {
        throw new Error(
          `${url} rendered without a stylesheet. The server is serving an ` +
            "incomplete build — copy .next/static and public/ into the standalone " +
            "output before auditing. Refusing to report measurements from it.",
        );
      }

      const shot = `${OUT}/${surface.name}-${vp.key}.png`;
      await page.screenshot({ path: shot, fullPage: true });

      let axe = { contrast: [], structural: [], error: null };
      try {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        axe = summarise(results);
      } catch (error) {
        axe.error = String(error).slice(0, 200);
      }

      // A page wider than its viewport is the defect a screenshot hides: the
      // capture is full-page, so sideways scroll looks like a normal layout.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      findings.push({
        surface: surface.name,
        path: surface.path,
        role: surface.as ?? "signed out",
        viewport: vp.key,
        status,
        screenshot: shot,
        scrollsSideways: overflow.scrollWidth > overflow.clientWidth + 1,
        overflowBy: Math.max(0, overflow.scrollWidth - overflow.clientWidth),
        ...axe,
      });
      audited += 1;
      process.stdout.write(`  ${vp.key.padEnd(8)} ${surface.name}\n`);
    }

    await context.close();
  }

  await browser.close();

  await writeFile(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));

  const structural = findings.flatMap((f) =>
    f.structural.map((v) => ({ ...v, surface: f.surface, viewport: f.viewport })),
  );
  const byRule = new Map();
  for (const v of structural) {
    const entry = byRule.get(v.id) ?? { id: v.id, help: v.help, impact: v.impact, total: 0, surfaces: new Set() };
    entry.total += v.count;
    entry.surfaces.add(`${v.surface}/${v.viewport}`);
    byRule.set(v.id, entry);
  }

  const lines = [
    "# UI audit",
    "",
    `${audited} page renders — ${SURFACES.length} surfaces × ${VIEWPORTS.length} viewports.`,
    "",
    "## Structural accessibility violations, by rule",
    "",
  ];
  if (byRule.size === 0) {
    lines.push("None found by axe-core.", "");
  } else {
    lines.push("| Rule | Impact | Instances | Surfaces |", "|---|---|---|---|");
    for (const e of [...byRule.values()].sort((a, b) => b.total - a.total)) {
      lines.push(`| \`${e.id}\` — ${e.help} | ${e.impact} | ${e.total} | ${e.surfaces.size} |`);
    }
    lines.push("");
  }

  const contrastTotal = findings.reduce((n, f) => n + f.contrast.reduce((m, c) => m + c.count, 0), 0);
  lines.push(`## Contrast`, "", `${contrastTotal} instances across all surfaces.`, "");

  const sideways = findings.filter((f) => f.scrollsSideways);
  lines.push("## Pages that scroll sideways", "");
  lines.push(
    sideways.length === 0
      ? "None."
      : sideways.map((f) => `- ${f.surface} (${f.viewport}) overflows by ${f.overflowBy}px`).join("\n"),
    "",
  );

  const broken = findings.filter((f) => f.status !== "ok");
  lines.push("## Surfaces that did not render", "");
  lines.push(
    broken.length === 0 ? "None." : broken.map((f) => `- ${f.surface} (${f.viewport}): ${f.status}`).join("\n"),
    "",
  );

  await writeFile(`${OUT}/report.md`, lines.join("\n"));

  console.log(`\n${audited} renders audited.`);
  console.log(`  structural violations: ${structural.reduce((n, v) => n + v.count, 0)}`);
  console.log(`  contrast instances:    ${contrastTotal}`);
  console.log(`  sideways scroll:       ${sideways.length}`);
  console.log(`  failed to render:      ${broken.length}`);
  console.log(`\n  ${OUT}/report.md and ${OUT}/findings.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
