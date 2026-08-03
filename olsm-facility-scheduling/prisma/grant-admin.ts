/**
 * Grant super-admin, from the server shell.
 *
 * The ordinary way to add an administrator is Admin -> People -> Add a person,
 * with the role set to Athletic Director. This script exists for the one case
 * that screen cannot serve: nobody can sign in to reach it.
 *
 * That happens more easily than it sounds. One administrator, their password
 * forgotten or their account switched off by accident, and the system has no way
 * back in -- the reset button lives behind the sign-in you cannot get past.
 * Editing the database by hand is the alternative this replaces, and it is worse:
 * a password hash pasted into psql leaves no audit trail and is easy to get
 * wrong.
 *
 * Usage, from the Render shell on the web service:
 *
 *     node dist-scripts/grant-admin.js someone@olsm.edu "Their Name"
 *
 * or in development:
 *
 *     npx tsx prisma/grant-admin.ts someone@olsm.edu "Their Name"
 *
 * It creates the account if it does not exist, raises it to SUPER_ADMIN,
 * reactivates it if it was switched off, and prints a one-time link for setting
 * a password. It never sets or prints a password: the link is the credential,
 * it works once, and it expires in seven days like any other.
 *
 * Anyone who can run this already has shell access to the server and could
 * change the database directly, so there is no additional lock on it. What it
 * does instead is leave a record: every grant is written to the append-only
 * audit log, marked as having come from the shell rather than from a person
 * clicking something.
 */

import { PrismaClient, Role } from "@prisma/client";
import { issueAccessToken } from "../src/lib/auth/access-token";

const prisma = new PrismaClient();

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error("Usage: grant-admin <email> [name]");
  console.error("Example: node dist-scripts/grant-admin.js ad2@olsm.edu \"Second Director\"");
  process.exit(1);
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const name = (process.argv[3] ?? "").trim();

  if (!email) usage("An email address is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage(`"${email}" is not an email address.`);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && existing.role === Role.SUPER_ADMIN && existing.active) {
    console.log(`${existing.name} <${email}> is already an active super admin.`);
    console.log("Sending them a fresh sign-in link anyway, in case that is why you are here.\n");
  }

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { role: Role.SUPER_ADMIN, active: true },
      })
    : await prisma.user.create({
        data: {
          // A name is optional at the command line because the point of this
          // script is to be usable in a hurry. The address is a fine stand-in
          // and the person can be renamed later.
          name: name || email,
          email,
          role: Role.SUPER_ADMIN,
          passwordHash: null,
          emailVerifiedAt: null,
        },
      });

  await prisma.auditLog.create({
    data: {
      entityType: "user",
      entityId: user.id,
      action: existing ? "user.granted_super_admin_from_shell" : "user.created_from_shell",
      actorLabel: "grant-admin script (server shell)",
      fromState: existing?.role ?? null,
      toState: Role.SUPER_ADMIN,
      reason: "Run directly on the server. No signed-in administrator performed this.",
      payload: { email, reactivated: Boolean(existing && !existing.active) },
    },
  });

  const token = await issueAccessToken({ userId: user.id });
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const link = `${base}/set-password/${token}`;

  console.log(existing ? `Raised ${user.name} <${email}> to super admin.` : `Created ${user.name} <${email}> as super admin.`);
  if (existing && !existing.active) console.log("The account was switched off; it is active again.");
  console.log("\nOne-time link to set a password (works once, expires in seven days):\n");
  console.log(`  ${link}`);
  if (!base) {
    console.log("\n  APP_URL is not set on this service, so the host is missing above.");
    console.log("  Put your own site's address in front of /set-password/…");
  }
  console.log("\nAny earlier link for this account has stopped working.");
  console.log("This was written to the audit log as coming from the shell, not from a person.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
