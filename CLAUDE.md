# Working in this repository

This is a fork of AutoGPT, but **no AutoGPT development happens here**. The
fork exists to host one application:

```
olsm-facility-scheduling/
```

A facility reservation, liability and revenue system for Orchard Lake
St. Mary's Preparatory athletics. Unless a request names something else
explicitly, that directory is the work.

`autogpt_platform/`, `classic/` and `docs/` are upstream and untouched. Do not
change them, and do not spend time reading them to answer a question about the
scheduling app.

## Getting the app running

Everything below runs from `olsm-facility-scheduling/`.

```bash
npm ci
npx prisma generate
npx prisma migrate deploy     # needs DATABASE_URL
npm run db:seed               # facilities, rules, rate cards, staff accounts
```

PostgreSQL 14+ is required. The tests are not mockable: they exercise a
database exclusion constraint that prevents double-booking and an append-only
audit trigger, neither of which exists outside a real Postgres.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Unit and integration (needs a database) |
| `npm run e2e` | Playwright, desktop and mobile projects |
| `npm run build` | Production build |

Seeded accounts all use the password `ChangeMe123456` — `ad@olsm.edu` is a
super admin, `bball.head@olsm.edu` a head coach.

## How the system is arranged

`src/domain/` is pure logic with no database access: pricing, the rules
engine, priority and bumping, the conflict graph, availability, booking state
transitions, cancellation. This is where behaviour is decided and where it is
cheapest to test.

`src/services/` composes that logic with the database. `booking-service.ts` is
the centre of the system — every kind of request goes through one
`createBooking`, from a coach's Tuesday practice to a company renting the
stadium. What differs between them is only which gates their rule row turns
on. **Do not add a fast path.** The single path is what stops a shortcut
quietly skipping the liability check.

`src/app/` is Next.js App Router. Server actions do the mutations.

## Things that look like bugs and are not

- **The seed never overwrites.** It creates what is missing and leaves the
  rest, because a restart used to revert every rate the business office had
  set. Do not change it back to an upsert.
- **Roles from Entra only ever rise.** A token cannot demote someone, and
  cannot promote an `EXTERNAL` account to staff at all. Lowering a role is an
  administrator's deliberate act.
- **Anonymous facility requests are switched off** via
  `ALLOW_ANONYMOUS_REQUESTS`. The code path still exists and is deliberate:
  turning it back on needs verified email, single-use tokens and rate limits
  first. Enforcement is in the server action, not just the page.
- **The app refuses to boot in production without a valid `APP_URL`.** That is
  intended. A service emailing links to `localhost` passes its health check
  while being useless.

## Known open items

`olsm-facility-scheduling/DECISIONS.md` lists what the school has not settled
— insurance limits, retention, agreement wording. Treat those as open
questions, not as things to invent an answer for.

One accepted defect: the per-account hold cap can be exceeded by exactly one
under simultaneous submissions. It is documented in `booking-service.ts` with
the intended fix, and its test is committed and skipped rather than deleted.
Do not describe that cap as a database guarantee.

## House style

Match the surrounding code. It favours explaining *why* over *what*, and
comments that say what a reader could not infer from the lines themselves.
American English in anything a user sees. Never put internal filenames,
configuration state or provider errors in user-facing text.
