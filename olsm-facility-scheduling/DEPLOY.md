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

`render.yaml` is a blueprint: it provisions the database, generates the
secrets and wires the cron job. It lives at the **repository root**, not in
this directory — Render only looks for it there. It points back here with
`rootDir`, so there is nothing to configure by hand.

1. Push this repository to GitHub.
2. Render → **New** → **Blueprint** → pick the repo.
3. Choose the branch the app is on, then **Apply**.
4. After the first deploy, set `APP_URL` on both the web service and the cron
   job to the URL Render assigned, then redeploy once so links in emails point
   somewhere real.

Both services take the **same public URL** -- the cron calls the web service
over HTTPS at its public address, so it wants that, not its own internal Render
hostname.

**Step 4 is not optional, and the cron job is the reason.** Until `APP_URL` is
set it has no address to call, so it exits with a clear message every five
minutes: nothing drains the outbound queue and no expired hold releases its
slot. The web service itself is fine without it; only links in emails are wrong.

Nothing needs installing locally for this — it runs entirely in the browser,
which matters if the machine you are on is managed and you cannot install
Docker.

The cron service runs `process-queue` and `expire-holds` on the same
five-minute tick. The remaining scheduled jobs — `daily-digest`,
`weekly-digest`, `nightly` and `refresh-calendar-channels` — are **not wired up
on Render**, because each needs its own schedule and therefore its own billable
cron service. Nothing breaks without them, but past bookings are not marked
complete, certificate-expiry warnings are not sent and stale sessions are not
pruned. Add them as further `type: cron` services when the pilot warrants it.

The web service is on the `starter` plan rather than free: free web services
sleep when idle, and a scheduling system that takes thirty seconds to wake up
will not get used. The database is on the free tier, which **expires after 30
days** — fine for a pilot, not fine for real bookings.

Render hands out a non-superuser database role, which resolves the audit-log
caveat described further down: on Render the app cannot drop its own audit
triggers.

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


---

## Microsoft Entra ID sign-in and Microsoft Graph mail

One app registration in the OLSM tenant does both jobs: signing staff in, and
sending mail as one mailbox.

### App registration

1. Entra admin centre → **App registrations** → **New registration**.
2. Supported account types: **Accounts in this organizational directory only**.
   This is the setting that matters. It makes the authority tenant-specific, so
   Microsoft itself refuses personal accounts and other tenants before a token
   is ever issued. The application checks the `tid` claim as well, but the first
   line of defence belongs here.
3. Redirect URI, type **Web**:
   `https://<your-host>/api/auth/entra/callback`
4. **Certificates & secrets** → new client secret. Record the expiry; sign-in
   stops when it lapses.
5. Copy the directory (tenant) id and application (client) id.

Set on the web service:

```
ENTRA_TENANT_ID=<directory (tenant) id>
ENTRA_CLIENT_ID=<application (client) id>
ENTRA_CLIENT_SECRET=<the secret value, not its id>
ENTRA_ALLOWED_DOMAINS=olsm.edu
```

`ENTRA_ALLOWED_DOMAINS` is a second filter on top of the tenant check: a tenant
can host guest accounts from other domains, and a guest is not an employee.

### Roles

Sign-in never creates an account and never grants a role on its own. An address
Entra vouches for that has no account here is turned away, because proving who
you are is not the same as being entitled to book a gym. Accounts are created in
Admin → People.

To have Entra drive roles, declare **app roles** on the registration and assign
them in the enterprise application. Recognised values:

| App role | Becomes |
|---|---|
| System Administrator | SUPER_ADMIN |
| Administrator, Athletic Director | FACILITY_ADMIN |
| Coach, Head Coach | HEAD_COACH |
| Assistant Coach | ASSISTANT_COACH |
| Athletic Trainer | TRAINER |
| Strength Coach | STRENGTH_COACH |
| Facilities, Maintenance | FACILITIES |
| Finance, Business Office | FINANCE |

Spacing, case and separators are ignored, so "Athletic Director" and
`athletic_director` both work. To use existing security groups instead, set
`ENTRA_GROUP_ROLE_MAP="<group-object-id>=FACILITY_ADMIN,<group-object-id>=FINANCE"`
and configure the app registration to emit group claims.

A token only ever **raises** somebody's role, never lowers it, and never touches
an external renter's account. A director whose group membership has not been set
up yet keeps the role an administrator gave them rather than being demoted to
coach on every sign-in.

**This has a cost, and it needs a procedure rather than more code.** Removing
somebody from an administrator group in Entra does *not* remove their privileges
here. Raising is automatic; lowering is deliberate. So:

- Entra may elevate a role. Only a local administrator may lower one.
- **Disabling the local account overrides everything.** It is the reliable
  off-switch, not the Entra group.
- Admin → People shows where each role came from, so a role Entra no longer
  supports is visible rather than silently retained.
- Review roles quarterly. It is a short list.
- When somebody leaves, disable **both** the Microsoft account and the local
  account here. Disabling only the Microsoft account leaves password sign-in
  working.

### Mail via Graph

Basic SMTP authentication is not used and is not an option -- Microsoft has
disabled it for Exchange Online, and it would mean storing a real mailbox
password.

1. On the same registration: **API permissions** → **Microsoft Graph** →
   **Application permissions** → `Mail.Send`. Nothing else is needed.
2. Grant admin consent.
3. **Scope it to the one mailbox.** `Mail.Send` as an application permission
   authorizes sending as *any* mailbox in the tenant. Narrow it with **Exchange
   Online RBAC for Applications**, which is Microsoft's current mechanism --
   Application Access Policies (`New-ApplicationAccessPolicy`) are superseded
   and new ones are advised against, since they will need migrating later.

   In Exchange Online PowerShell:

   ```powershell
   # The application, as Exchange sees it.
   New-ServicePrincipal `
     -AppId <application (client) id> `
     -ObjectId <service principal object id> `
     -DisplayName "OLSM facility scheduling"

   # A scope containing only the facilities mailbox.
   New-ManagementScope `
     -Name "OLSM facilities mailbox" `
     -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'facilities@olsm.edu'"

   # Send-as, limited to that scope.
   New-ManagementRoleAssignment `
     -Name "OLSM facility scheduling send as facilities" `
     -App <service principal object id> `
     -Role "Application Mail.Send" `
     -CustomResourceScope "OLSM facilities mailbox"
   ```

   Then prove both halves, because only the second one tells you the scope is
   doing anything:

   ```powershell
   Test-ServicePrincipalAuthorization -Identity <service principal object id> `
     -Resource facilities@olsm.edu     # expect the role to be listed

   Test-ServicePrincipalAuthorization -Identity <service principal object id> `
     -Resource <some other employee>   # expect nothing
   ```

   **Do not layer these mechanisms.** Permissions granted through Entra,
   Application Access Policies and Exchange RBAC are additive: an unrestricted
   Entra `Mail.Send` consent sitting alongside a scoped RBAC assignment gives
   the broader access, not the narrower one. Grant the Exchange application role
   scoped to the mailbox, and do not also leave a tenant-wide grant in place.

   Record the service principal object id and the mailbox scope somewhere the
   next administrator will find them.

Then set:

```
EMAIL_PROVIDER=graph
GRAPH_SENDER_MAILBOX=facilities@olsm.edu
EMAIL_FROM=facilities@olsm.edu
```

The mailbox comes from configuration, never from the message being sent, so a
bug elsewhere cannot address the request to a different sender.

### The local fallback

Email-and-password sign-in stays available. Somebody has to be able to get in
when the tenant is unreachable or a directory change locks staff out. Keep it to
a small number of accounts, and treat it as a fallback rather than a second
front door.

### What is never shown to a visitor

Tenant id, client id, client secret, tokens, and provider error text all stay
server-side. A failed sign-in says only that it failed; detail goes to the log
and, where there is an identity to attach it to, the audit trail. That includes
not revealing whether an account exists for a given address.
