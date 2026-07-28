"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { createSession, destroySession } from "@/lib/auth/session";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";

export interface FormState {
  error?: string;
  notice?: string;
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email address and password." };

  const user = await prisma.user.findUnique({ where: { email } });

  // Same message either way: an attacker must not learn which addresses exist.
  const failure = { error: "That email address and password do not match." };
  if (!user || !user.passwordHash || !user.active) return failure;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await recordAudit({
      entityType: "user",
      entityId: user.id,
      action: "auth.sign_in_failed",
      actorLabel: email,
      ipAddress: await clientIp(),
    });
    return failure;
  }

  if (user.role === Role.EXTERNAL && !user.emailVerifiedAt) {
    return { error: "Confirm your email address first. Check your inbox for the verification link." };
  }

  await createSession(user);
  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: "auth.sign_in",
    actorId: user.id,
    actorLabel: user.name,
    ipAddress: await clientIp(),
  });

  redirect(user.role === Role.EXTERNAL ? "/portal" : "/calendar");
}

export async function registerExternalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const organizationName = String(formData.get("organization") ?? "").trim();

  if (!name || !email || !password) return { error: "Name, email and password are required." };

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return { error: policy.message };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Do not confirm the address exists; tell them to sign in either way.
    return {
      notice: "If that address can be registered, you can now sign in. Otherwise, use sign in or password reset.",
    };
  }

  // Role is never taken from the form. Self-registration always lands on
  // EXTERNAL; an admin promotes from there.
  const organization = organizationName
    ? await prisma.organization.create({
        data: { name: organizationName, type: "COMMERCIAL", rateTier: "COMMERCIAL" },
      })
    : null;

  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone: phone || null,
      role: Role.EXTERNAL,
      passwordHash: await hashPassword(password),
      organizationId: organization?.id ?? null,
      // Email verification is sent below; the account cannot sign in until then.
      emailVerifiedAt: null,
    },
  });

  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: "user.self_registered",
    actorLabel: name,
    ipAddress: await clientIp(),
    payload: { email, organizationName: organizationName || null },
  });

  const { enqueue } = await import("@/services/job-queue");
  const { env } = await import("@/lib/env");
  const { randomToken } = await import("@/lib/auth/password");
  const token = randomToken(24);

  await prisma.session.create({
    // Reuse the session table as a short-lived verification token store.
    data: { id: token, userId: user.id, expiresAt: new Date(Date.now() + 2 * 86_400_000) },
  });

  await enqueue({
    kind: "notify.email",
    payload: {
      to: email,
      subject: "Confirm your OLSM facility request account",
      text:
        `${name},\n\nConfirm your email address to finish setting up your account:\n` +
        `${env.appUrl}/verify/${token}\n\nThis link expires in 48 hours.`,
    },
    idempotencyKey: `verify:${user.id}`,
  });

  return {
    notice: "Account created. Check your email for a confirmation link, then sign in.",
  };
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/sign-in");
}
