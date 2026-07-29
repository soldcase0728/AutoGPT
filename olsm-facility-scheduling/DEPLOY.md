# Deploying

Three routes, from least to most setup. All of them end with a URL you can send
someone and a database that migrates itself on boot.

Pick **Render** if you want a URL today and don't want to think about servers.
Pick **Docker Compose** if you'd rather it live on school hardware.
Pick **Vercel + Neon** if OLSM already uses Vercel.

---

## What every route needs

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL 14+ connection string |
| `SESSION_SECRET` | yes | 32+ random bytes. `openssl rand -base64 32`. Rotating it signs everyone out |
| `APP_URL` | yes | The public URL, e.g. `https://facilities.olsm.edu`. Used in emails and links |
| `TZ` | recommended | `America/Detroit` |
| `JOB_RUNNER_TOKEN` | recommended | Bearer token the scheduled jobs authenticate with |
| `LOAD_DEMO_DATA` | pilot only | `1` loads a sample week so a fresh instance is worth clicking. Set to `0` before real data |

Everything else is optional. **The app runs fully without a single third-party
credential** — email and SMS log to the container output, e-signature is
captured in-app, and payment steps are recorded but not charged. Add Google,
Stripe and DocuSign keys when you're ready; see `.env.example`.

---

## 1. Render — fastest to a URL

`render.yaml` is a blueprint: it provisions the database, generates the secrets
and wires the cron job.

1. Push this repository to GitHub.
2. Render → **New** → **Blueprint** → pick the repo.
3. Set the root directory to `olsm-facility-scheduling`.
4. Deploy. After the first deploy, set `APP_URL` to the URL Render assigned and
   redeploy once so links in emails are correct.

The free Postgres tier expires after 30 days. Fine for a pilot; move to a paid
tier before anyone depends on it.

---

## 2. Docker Compose — on your own machine

Needs Docker Desktop installed **and running** (the whale in the menu bar).

First get the code. You only do this once:

```bash
cd ~
git clone --depth 1 --branch claude/olsm-facility-scheduling-b4mmq5 \
  https://github.com/soldcase0728/AutoGPT.git olsm
cd olsm/olsm-facility-scheduling
```

Generate the secrets **once**, into a `.env` file that Compose reads
automatically:

```bash
cat > .env <<EOF
SESSION_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24)
EOF
```

Do this **before the first `up`**, not after, and rather than putting the
values on the command line. `.env` is gitignored.

The ordering matters more than it looks. Postgres bakes `POSTGRES_PASSWORD`
into the data volume the first time it initialises and ignores the environment
variable from then on. Set or change the password afterwards and the app's
connection string no longer matches the volume — the app crash-loops on an
authentication error while Postgres itself reports healthy, because from its
point of view nothing is wrong.

If you hit that, and the data is still disposable:

```bash
docker compose -f docker-compose.prod.yml down -v   # DELETES the database
docker compose -f docker-compose.prod.yml up -d
```

Once real bookings exist, take a dump first:
`docker compose -f docker-compose.prod.yml exec postgres pg_dump -U olsm_app olsm_facilities > backup.sql`

Then start it:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes several minutes — it installs dependencies and compiles
the app inside the container. Later starts take seconds.

Then open <http://localhost:3000>. Watch it come up with
`docker compose -f docker-compose.prod.yml logs -f app`.

Everyday commands, once `.env` exists:

```bash
docker compose -f docker-compose.prod.yml ps            # container health
docker compose -f docker-compose.prod.yml logs -f app   # follow the log
docker compose -f docker-compose.prod.yml restart app   # restart
docker compose -f docker-compose.prod.yml down          # stop, keep data
docker compose -f docker-compose.prod.yml down -v       # stop, DELETE the data
```

This runs three containers: the app, Postgres, and a small loop that hits the
scheduled-job endpoints every five minutes. There is **no TLS** — put it behind
a reverse proxy before anyone outside the school network uses it.

To make it reachable from other machines, set `APP_URL` to the host's address
and open the port.

---

## 3. Vercel + Neon

Vercel doesn't run the Docker image, so migrations need a build step.

1. Create a Neon (or Supabase) Postgres database; copy the pooled connection
   string.
2. Import the repo into Vercel with root directory `olsm-facility-scheduling`.
3. Set the environment variables from the table above.
4. Override the build command so migrations and seeding run on deploy:
   ```
   npx prisma migrate deploy && npx tsx prisma/seed.ts && npm run build
   ```
5. Add Vercel Cron entries pointing at the job endpoints (below).

---

## Scheduled jobs

Without these, reminders never send, expired holds never release their slots,
and the custodial digest never arrives. Each is a `POST` with
`Authorization: Bearer $JOB_RUNNER_TOKEN`.

| Schedule | Endpoint | Does |
|---|---|---|
| `*/5 * * * *` | `/api/jobs/process-queue` | Drains the outbound queue |
| `0 * * * *` | `/api/jobs/expire-holds` | Releases lapsed soft locks |
| `0 6 * * *` | `/api/jobs/daily-digest` | Custodial setup board email |
| `0 7 * * 1` | `/api/jobs/weekly-digest` | AD summary |
| `0 3 * * *` | `/api/jobs/nightly` | Completions, COI and waiver reminders, unresolved deposits |
| `0 4 * * *` | `/api/jobs/refresh-calendar-channels` | Renews Google push subscriptions |

The compose file runs the first two. The rest matter once real bookings exist.

---

## After it's up

**Check `/api/health`.** It returns `ok` only when the database is reachable
*and* reference data is loaded. A load balancer should watch this path.

**Sign in.** Seeded accounts all use `ChangeMe123456`:

| Account | Role |
|---|---|
| `ad@olsm.edu` | Athletic Director — sees everything |
| `bball.head@olsm.edu` | Head coach — the 30-second booking path |
| `bball.assistant@olsm.edu` | Assistant coach — routes to the head coach |
| `facilities@olsm.edu` | Facilities — setup board |
| `finance@olsm.edu` | Business office — read-only, invoices and reports |

**Change those passwords** before the instance is reachable by anyone outside
your network. They are published in this file and in the repository.

**Turn off the demo data** once real bookings go in: set `LOAD_DEMO_DATA=0` and
delete the sample bookings from the admin calendar.

---

## Two things to get right before real use

**Run the app as a non-superuser Postgres role — the compose setup does not.**
The append-only audit log is enforced by triggers, and a superuser can drop
them. A superuser connection string quietly removes the guarantee that the
liability trail is tamper-proof.

Being specific, because this file used to give the advice without admitting it
breaks its own rule: `docker-compose.prod.yml` sets `POSTGRES_USER=olsm_app`,
and the official Postgres image creates that role as a **superuser**. So in the
compose setup the app connects with rights to disable its own audit triggers.

For a pilot on a single machine that is an acceptable trade — the database is
not reachable outside the compose network, and the people with the connection
string are the people who own the data anyway. It stops being acceptable once
the audit log is the thing you would produce in an insurance dispute. Fixing it
properly means two roles: an admin role that owns the schema and runs
migrations, and a restricted role for the app with `INSERT`/`SELECT`/`UPDATE`
on the tables but no ownership of `audit_log` — because a table's owner can
`ALTER TABLE ... DISABLE TRIGGER` regardless of the trigger's contents.

Render and Neon do not have this problem; both hand out non-superuser roles.

**Check it rather than trusting this paragraph:**

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U olsm_app -d olsm_facilities < scripts/verify-guarantees.sql
```

That script attempts a real double-booking and a real audit-log edit against
the live database and reports whether each was refused. It writes nothing that
survives. Run it after any migration and after any restore from backup — a
restore is the most common way these constraints go missing without anyone
noticing.

**Back up the database.** The audit log is the liability record. Managed
Postgres does this for you; the compose setup does not — its data lives in a
Docker volume and nothing is backing it up.

---

## Running a pilot without the payment side

To trial scheduling only, disable the activity types that involve money and
contracts. In **Admin → Approval rules**, set `requiresAdminApproval` on
`PRIVATE_INSTRUCTION`, `CLUB_TRAVEL` and `EXTERNAL_RENTAL` and leave the public
request form unlinked. Coaches keep self-service booking; nothing can reach a
contract, an invoice or a certificate of insurance.

This is what lets you pilot before rates, insurance minimums and waiver wording
are settled — see `DECISIONS.md`.

---

## What has and hasn't been verified

Verified on a clean database, in this order: migrations apply, the seed loads
the eight facilities and the rules matrix, demo bookings load, the standalone
server starts, `/api/health` returns `ok`, public pages serve, and a **second
boot against the same database is idempotent** (16 bookings, not 32).

Also verified: `docker-compose.prod.yml` parses and interpolates cleanly under
Compose v5 (`docker compose config`), which is what catches the YAML-quoting
class of error.

Also verified, on macOS with Docker Desktop: the image builds from a clean
checkout, all three containers start, Postgres reports healthy, and
`/api/health` returns `{"status":"ok","database":"reachable","facilities":8}`
— which is only true once migrations have applied and the seed has run inside
the container.

Not verified on any other platform. That build was on a single machine; Linux
hosts and CI runners are untested. Nothing in the Dockerfile pins an
architecture — there are no Prisma `binaryTargets`, so engines are generated
inside the container for whatever it is running on — but "should be portable"
and "was run elsewhere" are different claims and only the first one is being
made here.

If a build does fail, the useful thing to send back is the last twenty lines of
the output; the step that failed is named in them. If a *container* fails,
`docker compose -f docker-compose.prod.yml logs --tail=40 app` — the entrypoint
prints what it rejected and what to do about it.
