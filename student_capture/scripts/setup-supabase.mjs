/**
 * One-shot setup against a real Supabase project: creates the private storage
 * bucket, applies every migration, and optionally loads the demo seed.
 *
 *   export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
 *   export SUPABASE_SERVICE_ROLE_KEY='...'          # Settings ▸ API
 *   export DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
 *   node scripts/setup-supabase.mjs [--seed]
 *
 * Safe to re-run: the bucket create is skipped if it exists, and every
 * migration is written to be idempotent.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUCKET = process.env.NEXT_PUBLIC_CAPTURE_BUCKET || "captures";
const MAX_BYTES = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES || 536_870_912);

const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]
  .filter((name) => !process.env[name]);

if (missing.length) {
  console.error(
    `Missing: ${missing.join(", ")}\n\n` +
      "The first two are in Supabase ▸ Settings ▸ API. DATABASE_URL is the\n" +
      "DIRECT connection string (Settings ▸ Database), not the pooler — the\n" +
      "migrations create types, triggers and policies.",
  );
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const auth = { authorization: `Bearer ${key}`, apikey: key };

// ---------------------------------------------------------------- bucket

/** Any network failure here is a wrong URL or no connectivity — say so plainly. */
async function api(target, init) {
  try {
    return await fetch(target, init);
  } catch (cause) {
    console.error(
      `Could not reach ${url}.\n` +
        "Check NEXT_PUBLIC_SUPABASE_URL is your project URL (Settings ▸ API)\n" +
        `and that this machine has network access.\n\n${cause.message}`,
    );
    process.exit(1);
  }
}

const existing = await api(`${url}/storage/v1/bucket/${BUCKET}`, { headers: auth });

if (existing.status === 200) {
  const bucket = await existing.json();
  console.log(`bucket "${BUCKET}" already exists`);
  if (bucket.public) {
    console.error(
      `\nREFUSING TO CONTINUE: bucket "${BUCKET}" is PUBLIC.\n` +
        "Captures of students must not be world-readable. Make it private in\n" +
        "the Supabase dashboard (Storage ▸ the bucket ▸ Settings) and re-run.",
    );
    process.exit(1);
  }
} else if (existing.status === 404) {
  const created = await api(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: MAX_BYTES,
      allowed_mime_types: ["video/*", "image/*"],
    }),
  });
  if (!created.ok) {
    console.error(`Could not create the bucket (${created.status}): ${await created.text()}`);
    process.exit(1);
  }
  console.log(`created private bucket "${BUCKET}" (limit ${MAX_BYTES} bytes)`);
} else {
  console.error(`Unexpected response checking the bucket (${existing.status}).`);
  console.error(await existing.text());
  process.exit(1);
}

// ------------------------------------------------------------ migrations

const psql = (file) => {
  try {
    execFileSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch (cause) {
    // A stack trace here helps nobody; the two real causes are a missing psql
    // and a connection string that points at the pooler or is simply wrong.
    if (cause.code === "ENOENT") {
      console.error("\npsql is not installed, or not on PATH. Install the Postgres client tools.");
    } else {
      console.error(
        `\nFailed while applying ${path.basename(file)}.\n` +
          "If this is a connection error, check DATABASE_URL is the DIRECT\n" +
          "connection string from Settings ▸ Database, not the pooler.",
      );
    }
    process.exit(1);
  }
};

for (const name of readdirSync(path.join(ROOT, "supabase/migrations")).sort()) {
  if (!name.endsWith(".sql")) continue;
  console.log(`applying ${name}`);
  psql(path.join(ROOT, "supabase/migrations", name));
}

if (process.argv.includes("--seed")) {
  console.log("loading supabase/seed.sql");
  psql(path.join(ROOT, "supabase/seed.sql"));
}

console.log(`
Done.

Next:
  1. Put your own people in the roster. Sign-in only claims an existing row:
       insert into people (org_id, role, display_name, email, birth_year)
       values ('<org id>', 'admin', 'Your Name', 'you@school.edu', 1990);
     Seeded demo rows use @example.edu — replace them before inviting anyone.
  2. Supabase ▸ Authentication ▸ URL Configuration: add your app's origin to
     the redirect allow-list, or the magic link will bounce.
  3. pnpm dev, sign in, and open /poster to print the QR.
`);
