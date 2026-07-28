# OLSM Facility Scheduling

Reservation, liability and revenue-capture system for Orchard Lake St. Mary's
Preparatory athletic facilities.

It does three things that the current email/text/whiteboard arrangement cannot:

1. **Stops double-booking**, including the hard case where two sports want
   overlapping parts of the same room. Enforced by a PostgreSQL exclusion
   constraint, not by UI validation.
2. **Routes non-team use through approval → contract → waiver → insurance →
   payment** before a booking is confirmed — and does it based on *what the
   activity is*, so a head coach running paid Saturday lessons clears the same
   gates as an outside company.
3. **Keeps in-season team scheduling frictionless.** A head coach booking a
   practice hits zero of those gates and is confirmed instantly.

---

## Quick start

```bash
cp .env.example .env          # then set DATABASE_URL and SESSION_SECRET
docker compose up -d postgres # or point DATABASE_URL at any Postgres 14+
npm install
npm run db:migrate            # applies schema + constraints
npm run db:seed               # 8 facilities, rules matrix, sample staff
npm run dev
```

Sign in at `/sign-in` with any seeded address (`ad@olsm.edu`,
`bball.head@olsm.edu`, `facilities@olsm.edu`, …), password `ChangeMe123456`.

```bash
npm test          # 114 tests: unit + integration against a real database
npm run typecheck
npm run build
```

Integration tests need a database. They use `TEST_DATABASE_URL` if set, so they
never touch development data.

---

## The design decision that matters most

The brief's instinct was to key approval on **who is asking**: head coaches
self-serve, everyone else gets reviewed. That leaks the exact revenue and
liability this project exists to capture — a head coach running a paid skills
clinic, a personal-training business, or a travel team on a Saturday is
precisely the use you want to see, and a role-only rule waves it straight
through with no contract, no waiver and no payment.

So approval is keyed on **activity type first, requester role second**:

```
selectRule(rules, activityType, requesterRole)
  1. exact match on (activityType, requesterRole)
  2. fall back to (activityType, null)
```

`PRIVATE_INSTRUCTION` has no role-specific rows at all. A head coach requesting
it matches the generic row and clears every gate. Meanwhile `TEAM_PRACTICE` has
a `HEAD_COACH` row with `autoApprove`, so routine practice stays instant.

The whole matrix lives in the `rules` table and is editable at
**Admin → Approval rules**. Adding an activity type is a row plus an enum value;
no logic changes.

### Liability capture without friction

Coverage comes in two layers, because the requester and the people on the floor
are usually not the same population.

**Layer 1 — the Annual Coach Agreement.** Every coach, trainer and strength
coach signs one per school year covering facility rules, supervision,
emergency/AED procedure, concussion protocol, indemnification, and an
attestation not to run outside paid instruction without booking it as such.
**No current signed agreement ⇒ the account cannot create any booking.** After
August it costs a head coach nothing.

**Layer 2 — participant waivers.** For camps, clinics, club use and rentals,
every participant signs their own release, by roster upload or through one
shared public link per booking. Minors are signed for by a named guardian,
enforced by a database check constraint. Participant waivers deliberately do
*not* block `CONFIRMED` — a camp confirms in March and fills its roster in June
— so they are chased by pre-event reminders and surfaced on the booking instead.

Contracts and certificates of insurance apply only to paid, external and
non-team activity, and those *do* block confirmation.

---

## How the guarantees are enforced

| Guarantee | Where it lives | Why there |
|---|---|---|
| No overlapping bookings | `booking_occupancy_no_overlap` GiST exclusion constraint | Application checks lose races. The constraint cannot. |
| Sub-space containment | `SubSpace.blocksIds` graph, expanded before insert | One constraint can't express "Full floor contains Court A"; expanding into occupancy rows can. |
| Audit log is immutable | `BEFORE UPDATE/DELETE/TRUNCATE` triggers on `audit_log` | This is the liability paper trail. Application-level "don't edit it" is not a control. |
| Rules can't rewrite history | `BookingRequirement.ruleSnapshot` | Editing a rule must not retroactively change what a cleared booking owed. |
| Only CONFIRMED reaches Google | `advanceBooking` enqueues sync on CONFIRMED only | Pending holds are not commitments. |

### The conflict graph

Each sub-space lists what it physically occupies:

```
Full floor  → blocks [Court A, Court B]
Court A     → blocks []
Court B     → blocks []
```

Booking Full floor writes occupancy rows for all three, so Court A collides.
Booking Court A writes one row, so Court B stays free. The relationship is
symmetric in effect without being declared twice, and it is transitive — the
walk in `occupiedSubSpaceIds` runs to a fixed point.

Cross-facility adjacency uses the same mechanism: the stadium field lists the
running track in its `blocksIds`, so a football game closes the track. Editable
at **Admin → Facilities → Conflict rules**.

### Booking lifecycle

```
DRAFT → PENDING_APPROVAL → APPROVED → AWAITING_DOCUMENTS
      → AWAITING_PAYMENT → CONFIRMED → CHECKED_IN → COMPLETED
      ↘ CANCELLED / DENIED / EXPIRED / NO_SHOW
```

Gates are skippable, not reorderable: an auto-approved practice goes
`DRAFT → CONFIRMED` in one transition because none of the intermediate gates
apply. `nextStatus()` is the only place that decides, so the fast path and the
slow path cannot drift apart.

From `PENDING_APPROVAL` onward a booking holds a **soft lock** on its slot.
Locks expire (72h documents / 120h payment, per rule) and release automatically;
`releaseExpiredHolds()` also runs before every conflict check, so an abandoned
request never squats on a slot waiting for the next cron tick.

---

## Integrations

All four are behind adapters and degrade to an inert local mode when
unconfigured, so the app boots and the test suite runs with zero third-party
credentials.

**Google Calendar** — service account with domain-wide delegation, one calendar
per facility, **one-way**. The app writes; Google displays. Edits made directly
in Google Calendar are detected via push notification and **reverted**, with a
note to the booking owner. Two-way sync on a system with approval and payment
gates creates conflict states nobody can resolve: a coach dragging a confirmed,
paid rental to another court in Google has no way to re-run the conflict check,
the contract or the invoice. Read-only iCal feeds at `/api/feeds/<slug>.ics`
serve non-Google users and the public site.

**Stripe** — Checkout for card and ACH; no card data touches this app. Security
deposits are manual-capture authorisations: after the rental the hold is either
released untouched or partially captured with a written reason, which is both
audited and emailed to the renter. An authorisation lapses at Stripe after about
a week, so unresolved holds raise a nightly admin alert. Webhooks are
signature-verified with replay protection and every mutating call carries an
idempotency key.

**DocuSign / Dropbox Sign** — one `EsignProvider` interface, chosen by
`ESIGN_PROVIDER`. A third `manual` provider keeps the full document state
machine with in-app signature capture; it is what runs before OLSM picks a
vendor, and it makes the document flow testable.

**Email / SMS** — SendGrid or Postmark, and Twilio, both defaulting to a console
transport so a dev or test run never emails a real coach.

Everything outbound goes through a durable job queue (`job_queue`) with
exponential backoff. A job that exhausts its retries alerts an admin — calendar
sync never fails silently. Swap the queue for Inngest or BullMQ by
reimplementing `enqueue`; no caller changes.

### Scheduled jobs

`POST /api/jobs/<name>` with `Authorization: Bearer $JOB_RUNNER_TOKEN`:

| Cron | Job | Does |
|---|---|---|
| `*/5 * * * *` | `process-queue` | Drain outbound queue |
| `0 * * * *` | `expire-holds` | Release lapsed soft locks |
| `0 6 * * *` | `daily-digest` | Custodial setup board |
| `0 7 * * 1` | `weekly-digest` | AD summary |
| `0 3 * * *` | `nightly` | Completions, COI warnings, payment and waiver reminders, unresolved deposits, session prune |
| `0 4 * * *` | `refresh-calendar-channels` | Renew Google push subscriptions |

---

## Layout

```
prisma/
  schema.prisma             data model
  migrations/               schema + the constraints that carry the guarantees
  seed.ts                   facilities, conflict graph, rules matrix, rates
src/
  domain/                   pure logic, no I/O — the testable core
    conflict-graph.ts       sub-space containment
    rules-engine.ts         which rule applies
    booking-state.ts        state machine and gate ordering
    priority.ts             ranking and bump assessment
    pricing.ts              rate cards, quotes, tier resolution
    cancellation.ts         refund policy
    compliance.ts           annual agreement, COI validity
    recurrence.ts           RRULE expansion in local wall-clock time
    allocation.ts           season collision detection, open inventory
    availability.ts         hours, blackouts
  services/                 orchestration and persistence
    booking-service.ts      creation, gates, bumping, cancellation
    participant-service.ts  rosters and public waiver links
    deposit-service.ts      hold, release, partial capture
    weather-service.ts      close a facility for a day
  integrations/             Google, Stripe, e-sign, mail, storage
  lib/                      db, auth, audit, time
  app/                      Next.js App Router: pages, actions, API routes
tests/
  unit/                     domain logic, no database
  integration/              acceptance criteria against real Postgres
```

`src/domain` has no database or network imports, which is why the bulk of the
logic is testable without fixtures.

---

## Screens

**Public** — facility directory with rates and availability, four-step request
wizard, requester portal (requests, documents, invoices).

**Coach / staff** — unified filterable calendar, quick-book (target: under 30
seconds for in-season practice), my team's schedule with one-click block
release, waitlist for windows that are already taken, my documents.

**Admin** — approval queue with inline conflict warnings, season allocation
builder with collision resolution, facility/sub-space/conflict-graph editors,
rate cards, the rules matrix, blackouts, weather call (close an outdoor facility
for a day in one action), deposit release/capture, reports, people, audit log
with CSV export.

**Facilities** — daily setup board grouped by building with turnover times and
setup notes; check-in; mark a space unavailable.

**Participants** — one public link per booking where anyone in the group signs
their own release, no account required.

Mobile-first (coaches will use phones on the field), WCAG 2.1 AA, navy and gold.

---

## Verified acceptance criteria

All 114 tests pass. Mapping from the brief:

| # | Criterion | Test |
|---|---|---|
| 1 | Head coach practice confirms instantly, no gates | `booking-flow` → *confirms immediately…* |
| 2 | Same coach's private lesson needs approval + contract + waiver + COI + payment | `booking-flow` → *requires approval, a contract…* |
| 3 | Unsigned/expired agreement blocks all booking, shows signing link | `booking-flow` → *annual coach agreement enforcement* |
| 4 | Overlap rejected **by the database**, not just the UI | `booking-flow` → *is enforced by a database constraint…* |
| 5 | Full floor blocks Court A and B; A alone does not block B | `booking-flow` + `conflict-graph` |
| 6 | Season allocation surfaces every collision; nothing publishes until resolved | `allocation` → *refuses to publish…* |
| 7 | Contest bumps external rental; auto-notified and auto-refunded | `booking-flow` → *lets a varsity contest bump…* |
| 8 | Expired COI blocks confirmation; 30-day admin warning | `booking-flow` → *blocks confirmation when the COI expires…* |
| 9 | Google Calendar edits reverted, editor notified | `calendar-diff` (detection) + `revertCalendarEdit` |
| 10 | No refund inside the window; per policy outside; both logged | `booking-flow` → *cancellation and refunds* |
| 11 | Revenue report by facility, activity type, organisation, any range | `reporting-service.revenueReport`, `/admin/reports` |
| 12 | Append-only audit log no role can edit or delete | `booking-flow` → *cannot be updated or deleted by any role* |

Criterion 9's write-back and criterion 11's UI are exercised against the live
Google API and in the browser respectively; the logic beneath both is tested.

Beyond the twelve, `operations.test.ts` covers the participant-waiver flow
(including guardian signatures for minors and the refusal to sign after an event
has finished), the deposit lifecycle (release, partial capture, over-capture
refusal, double-resolution refusal), and weather cancellation (bulk cancel with
full refunds inside the no-refund window, plus SMS to opted-in requesters).

---

## Deployment notes

- **Run the app as a non-superuser Postgres role.** The append-only audit
  triggers can be dropped by a superuser; a superuser connection string quietly
  removes the guarantee.
- `SESSION_SECRET` must be 32+ random bytes. Rotating it signs everyone out.
- Set `GOOGLE_CALENDAR_WEBHOOK_TOKEN`, or calendar push notifications are
  rejected and edit-revert stops working.
- Point cron at the job endpoints above. Without `process-queue`, nothing
  outbound is ever delivered.
- Stripe webhooks must reach `/api/webhooks/stripe` with the raw body intact.

---

## Before this handles a real booking

`DECISIONS.md` lists every open item, with the placeholders currently in the
code. The short version: **all pricing is fabricated**, the agreement and waiver
text is unreviewed scaffolding, and the insurance minimums, retention periods
and cancellation windows need OLSM's carrier and counsel. None of that blocks
Phase 1 or 2 use (scheduling and season allocation), all of it blocks taking
money from an outside organisation.

## Build vs. buy

The brief rightly flags this. Facilitron, rSchoolToday, ML Schedules and
EventPro all cover approval workflows, e-signature and online payment for school
facility rental, several at low or no direct cost by taking a percentage of
rental revenue. If OLSM's non-team rental volume is modest, a vendor is likely
better economics.

What a vendor will not give you is the head-coach auto-approve path, the
activity-type-first approval model, and the season allocation logic — which is
where OLSM's actual pain lives. Price the vendors before committing; the
scheduling core here is useful either way, and Phases 1–2 stand alone without
the payment stack.
