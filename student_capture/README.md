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

## Kill rules

Product invariants that the system must not allow to be violated. Each is
enforced where it cannot be argued with — mostly in the database, so no client,
script, or future route can route around it — and each has a test in
`supabase/tests/30_kill_rules.sql` that fails loudly if the enforcement is
removed.

| # | Rule | Enforced by | Test |
|---|---|---|---|
| 1 | Nothing goes public without human review. A submission is never an approval, and there is no automatic publishing. | Two independent defenses: the `captures_update_own_while_uploading` RLS check restricts a student to `uploading → submitted`, and the `captures_state_machine` trigger states the whole rule | rule 1 |
| 2 | Terms are not a recurring login screen. | `has_current_release()` matches the accepted version, so someone who accepted the current wording is never asked again | rule 2 |
| 3 | New legal language needs a new affirmative acceptance, with its own timestamp and version. | An older acceptance does not satisfy a new version, and `consents_immutable` refuses to let a consent row be edited in place — you supersede it with a new row | rule 3 |
| 4 | The school never takes ownership or gives the work away. | The release text: the student keeps copyright, permission covers school-owned accounts and school marketing only, no sale, no third-party licensing | consent wording |
| 5 | Protected or dangerous material never appears in frame; if found after posting, it comes down. | Required brand rules at capture time, plus `take_down_capture()` — staff only, reason mandatory, writes an audit row | rule 5 |
| 6 | **Unsafe filming is never part of the programme.** | Safety is a distinct kind of guideline: always required whatever the source data says, always sorted first, and rendered in its own emphasised block. Anyone can file a report — see below | rule 6 |
| 7 | Credential status cannot be bypassed. | `people.participation` is `pending` by default; only a person can move someone to `active`, and `revoked` is read-only. A school email address grants nothing on its own — sign-in only claims an existing roster row | rule 7 |

The tests are mutation-checked: removing any single enforcement makes the suite
fail. Rule 1 is deliberately defended twice, so breaking it takes removing both
the policy predicate and the trigger.

> **Note.** You described these as ten rules and listed seven. Rules 8–10 are
> not implemented because they were not stated — send them and they get the
> same treatment rather than a guess.

### Reporting unsafe filming

`POST /api/safety` takes a report from **anyone signed in** — above all the
student who was asked to do something unsafe. The report is written to
`safety_flags` and the audit log first, then alerted, so a chat outage can
never lose one.

Set `SAFETY_ALERT_WEBHOOK_URL` to a Slack or Teams incoming webhook and every
report pages the channel. Unset, reports still land in the database and staff
see them at `GET /api/safety`; they just do not page anyone. On the capture
screen the control sits inside the safety block, two taps away, and says
plainly that a prompt which cannot be shot safely should not be shot.

One thing this surfaced immediately: the seeded prompt "The walk to practice"
told students to *start walking before you hit record*, which is the exact
thing rule 6 forbids. It is now "The path to practice", filmed standing still.
Check the rest of your idea bank for the same contradiction — a prompt that
asks for an unsafe shot defeats every control downstream of it.

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

Or let the setup script do the bucket and the migrations in one go:

```bash
export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'      # Settings ▸ API
export DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
pnpm setup -- --seed
```

It creates the bucket **private**, with the upload size limit and image/video
mime restrictions applied, and refuses to continue if the bucket already exists
and is public. Re-running it is safe.

One thing the script cannot do for you: add your app's origin to Supabase ▸
Authentication ▸ URL Configuration. Without it the magic link bounces.

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

## Looking at it without a Supabase project

```bash
pnpm dev            # then open http://localhost:3000/preview
```

`/preview` renders every screen from fixtures with nothing behind it. These are
the same view components the real pages use — `TodayView`, `CaptureFlow`,
`ConsentView`, `SubmissionsView`, `ReviewQueue` — so the preview cannot drift
from the app. The routes call `notFound()` when `NODE_ENV` is production, and
the build bakes them as 404 pages.

To capture them:

```bash
NODE_PATH=$(npm root -g) node scripts/screenshots.mjs .tmp-shots http://localhost:3000
```

It fails on a non-200, an empty body, or a console error, which catches things
`next build` and `tsc` both wave through — a server component handing a client
component a function prop, for one.

### Deploying a demo with no database

Set `DEMO_SCREENS=1` at build time and the `/preview` screens are served in a
production build. With no Supabase project configured the app redirects every
route there, so the deployment is a usable walkthrough of the real UI rather
than a wall of 500s. Off by default; the routes 404 without it.

It is only safe because those screens render hard-coded fixtures — there is no
database for them to read from.

## Verifying

```bash
pnpm test        # 33 unit tests over the pure logic
pnpm types       # tsc --noEmit
pnpm lint
pnpm build
pnpm shots       # requires a dev server and Playwright; see above
pnpm db:verify   # spins up a throwaway Postgres, applies every migration,
                 # runs the consent-gate, RLS and kill-rule tests against it
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

## The QR poster

`/poster` renders a printable card for a locker-room wall: your organisation's
name, a headline, and a QR pointing at the app. Staff only. Print it with the
browser's print dialog — the page carries its own `@page` rules and forces a
light palette, so it does not burn a toner cartridge.

```
/poster                                   → QR to this app's own origin
/poster?url=https://…&headline=Game+week  → point it anywhere, retitle it
```

Only `http`/`https` targets are encoded; anything else falls back to the app's
origin, so a printed code can never carry a `javascript:` or `data:` payload.

## Pushing captures into OneDrive / SharePoint

Marketing already lives in SharePoint, so approved masters can be pushed there
rather than downloaded and re-uploaded by hand:

```bash
curl -X POST https://your-app/api/review/push-to-onedrive \
  -H 'content-type: application/json' -d '{"state":"approved","limit":25}'
```

Each file streams a chunk at a time from Supabase Storage straight into a Graph
upload session, so a 200 MB clip never sits whole in the app's memory. Files
land in `MS_EXPORT_FOLDER/<submission date>/` named
`<date>-<student>-<idea>.<ext>`, and conflicts rename rather than overwrite — an
export must never quietly replace something already in the marketing folder.

Unconfigured, the route answers `501` with the list of variables to set rather
than failing obscurely.

### Setting up the app registration

1. Entra admin centre ▸ **App registrations** ▸ New registration. No redirect
   URI is needed — this is app-only.
2. **Certificates & secrets** ▸ new client secret. Copy it now; it is not
   shown again.
3. **API permissions** ▸ Microsoft Graph ▸ *Application* permissions ▸
   `Sites.Selected`, then **Grant admin consent**. Prefer this over
   `Sites.ReadWrite.All`: it grants nothing until a SharePoint admin also
   assigns the app to the one target site
   ([site-post-permissions](https://learn.microsoft.com/graph/api/site-post-permissions)).
4. Find the target drive id — in Graph Explorer,
   `GET /sites/{host}:/sites/{site}:/drives`.
5. Fill in `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_DRIVE_ID`
   and optionally `MS_EXPORT_FOLDER`.

Delegated permissions will not work here: the export runs on a schedule with
nobody signed in, so it needs an application permission.

Two Graph rules the upload code exists to respect, both of which fail late and
confusingly if you get them wrong: every chunk but the last must be a multiple
of **320 KiB**, and the chunk `PUT` must **not** carry an `Authorization`
header — the upload URL is already pre-authenticated, and sending a bearer
token makes Graph answer 401. `src/lib/graph/chunks.ts` is pure and unit
tested so the arithmetic is checkable without a tenant.

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
src/lib/graph/         Microsoft Graph: token, upload sessions, chunk planning
src/app/               student pages, review queue, route handlers
tests/                 vitest over src/lib
```
