# Student Capture — phase 1

A daily prompt goes out, a student shoots one clip, and marketing receives it
with enough context to write the post without chasing anyone.

This is phase 1 of that: capture and review, and nothing else. It is a
standalone Next.js + Supabase app. It does not import from `autogpt_platform`
and does not need it to run — the AutoGPT graphs arrive in phase 2, over the
platform's external API (see [Phase 2](#where-phase-2-plugs-in)).

## What is here

**Student side.** Magic-link sign-in, today's prompt, the guideline checklist on
the capture screen, a resumable upload straight to storage, one line of context,
done. The whole loop is built to fit in under sixty seconds.

**Marketing side.** A review queue with inline playback and keyboard shortcuts
(`J`/`K` to move, `A` approve, `R` ask for changes, `X` reject, `P` mark
posted), the consent state of every capture shown inline, and a bulk export of
signed master URLs.

**Consent.** Captured at onboarding and enforced by the database before
anything can be published.

### Deliberately not here yet

Transcripts, caption drafting, streaks and leaderboards, SMS nudges, transcoded
proxies, scheduled posting, analytics. All phase 2 or 3. Adding any of them now
buys nothing until the loop itself is proven.

## How the consent model works

Three things are versioned or attached differently on purpose:

| | Where it lives | Enforcement |
|---|---|---|
| **Craft rules** (9:16, 10–30s, lighting) | Structured items on the guideline set attached to each idea, rendered as a pre-shoot checklist | Soft — a checklist, plus format checks that warn rather than block |
| **Brand rules** (logo, tone, what never goes out) | Versioned guideline documents scoped to the org | Soft — shown at capture, flagged in review |
| **Consent** (media release, parental, NIL) | A ledger keyed to a **person**, never to a file | **Hard** — a database trigger refuses to publish |

Two properties make this auditable a year later:

- **Guidelines are versioned with an effective date**, and every capture stores
  the `guideline_version_ids` it was shot under. The wording can change without
  rewriting history.
- **Consent attaches to people.** A capture records who is in frame; the gate
  joins the two. That turns "take that down" into a query instead of an
  archaeology project.

The gate itself is `capture_consent_blockers()` in
[`supabase/migrations/0003_consent_gate.sql`](supabase/migrations/0003_consent_gate.sql).
It blocks on a missing, revoked or expired media release; on a minor without a
parental release; on an **unknown birth year**, since we cannot then tell
whether one is required; and on a capture where nobody is tagged and the student
did not affirm that nobody is identifiable. A `before update` trigger enforces
it however the update arrives, so no client can route around it.

Revocation reaches backwards: withdrawing a release pulls every published
capture that person appears in back to `approved` and writes an audit row.

Where the gate sits matters. It is between **approval and publication**, not
between capture and submission — a student can always shoot and send, and it is
the posting that waits.

## Setup

```bash
cp .env.example .env.local     # fill in from Supabase ▸ Settings ▸ API
pnpm install
```

Create a **private** storage bucket named `captures`, then apply the schema:

```bash
DATABASE_URL='postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres' \
  pnpm db:apply -- --seed
```

Use the direct connection string rather than the pooler — the migrations create
types, triggers and policies. `0004_supabase_bindings.sql` is the only migration
that touches Supabase-managed schemas (`auth`, `storage`); the other three apply
to any Postgres.

```bash
pnpm dev
```

Students are **roster-gated**: rows in `people` come first, and signing in only
claims the row whose email matches. Someone who authenticates without one gets
told they are not on a roster. Edit the addresses in `supabase/seed.sql` before
seeding anything real.

### The daily job

Assignments are materialised by a scheduled `POST`, and the unique constraint on
`(person_id, due_on)` makes re-running it a no-op:

```bash
curl -X POST https://your-app/api/assignments/run \
  -H "x-capture-cron-secret: $CAPTURE_CRON_SECRET" \
  -H 'content-type: application/json' -d '{"dryRun": true}'
```

Point cron at it for 7am in your timezone. Drop `dryRun` to actually assign.

## Verifying

```bash
pnpm test        # 33 unit tests over the pure logic
pnpm types       # tsc --noEmit
pnpm lint
pnpm build
pnpm db:verify   # spins up a throwaway Postgres, applies every migration,
                 # runs the consent-gate and RLS tests against it
```

`pnpm db:verify` needs the Postgres binaries on `PATH` (no Docker, no network).
It shims `auth` and `storage`, applies all four migrations plus the seed, and
asserts the gate's behaviour end to end — including that publishing a blocked
capture raises, that revocation unpublishes, and that one student cannot read
another's captures through RLS.

## Notes from the build

**Uploads never transit this server.** `POST /api/uploads/start` reserves a
capture row and an object key; the phone then uploads directly to Supabase
Storage over tus, resumable, in 6 MB chunks (the size Supabase requires). A
30-second 4K clip is 100–200 MB and campus wifi drops — a single-shot POST would
lose students permanently. `/submit` refuses to finalise a capture whose object
is not actually in the bucket.

**iOS backgrounds Safari and the upload dies.** The capture screen keeps a
foreground progress bar and resumes from the last chunk on retry rather than
pretending it succeeded.

**Storage keys are `<person_id>/<capture_id>/<filename>`** because the first
path segment is what the storage RLS policy checks. Filenames from phones are
sanitised (`safeFilename`), which is also what stops a crafted name escaping the
prefix.

**Review plays the master today.** `proxy_key` exists on `captures` and
`/api/captures/[id]/media` already prefers it. When the phase 2 ingest worker
starts writing proxies, that route is the only thing that changes.

**`scan_status` and `exif_stripped` are surfaced, not faked.** Nothing sets them
yet; the review UI shows "not yet scanned" and "location not stripped" chips so
the gap is visible rather than silently assumed away. The ingest worker that
fills them in is phase 2, and ClamAV is already in the platform's compose stack.

**`birth_year`, not a date of birth.** A year is all the gate needs to decide
whether a parental release is required, and far less damaging to hold. Nothing
academic is in the schema at all — no grades, schedules, student IDs or roster
imports — which keeps this out of a compliance conversation it does not need to
be in.

**One known build warning.** `@supabase/ssr` trips the Edge runtime's
`process.version` check from middleware. It is the pattern Supabase documents,
and it is a warning rather than a failure.

## Where phase 2 plugs in

The app calls AutoGPT over its external API rather than living inside it:

```
POST /api/external/v1/graphs/{graph_id}/execute/{graph_version}
GET  /api/external/v1/graphs/{graph_id}/executions/{id}/results
```

with an API key scoped to `EXECUTE_GRAPH`. Four graphs cover the phase 2 work:

| Trigger | Graph |
|---|---|
| On submit | Transcribe, auto-tag, draft caption variants, check craft rules, write back |
| Daily 7am | Draw tomorrow's ideas and send the nudges (replaces the cron hitting `/api/assignments/run`) |
| On approve | Post or schedule via the Ayrshare blocks in `autogpt_platform/backend/backend/blocks/ayrshare/` |
| Weekly | Digest to marketing: what came in, what is unused, who has gone quiet |

The graphs draft and stage. A person still approves and releases.

## Layout

```
supabase/migrations/   schema, RLS, the consent gate, Supabase bindings
supabase/tests/        SQL assertions run by pnpm db:verify
src/lib/               pure logic (unit tested) + Supabase clients
src/app/               student pages, review queue, route handlers
tests/                 vitest over src/lib
```
