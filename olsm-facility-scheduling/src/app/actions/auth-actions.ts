"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { createSession, destroySession } from "@/lib/auth/session";
import { accessTokenMessage, consumeAccessToken } from "@/lib/auth/access-token";
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

  // Belt and braces. Setting a password is the only way to get one, and that
  // path marks the address verified in the same write, so this should not be
  // reachable -- but if it ever is, the office can send a fresh link.
  if (user.role === Role.EXTERNAL && !user.emailVerifiedAt) {
    return { error: "That account is not set up yet. Ask the athletic office to send you a sign-in link." };
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

/**
 * Finish an invitation, or a reset, by choosing a password.
 *
 * The token is spent here, on submit -- never while rendering the page that
 * offers this form. Link scanners fetch every URL in inbound mail, and this
 * school runs Microsoft 365, so a link consumed on GET is a link the recipient
 * always finds already used.
 */
export async function setPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) return { error: "That link is missing part of its address. Open it again from the email." };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return { error: policy.message };

  // Hash before spending the token. bcrypt takes a moment, and a token spent on
  // a request that then fails is a person locked out of their own invitation.
  const passwordHash = await hashPassword(password);

  const claim = await consumeAccessToken(token);
  if (!claim.ok) {
    return { error: accessTokenMessage(claim.reason) };
  }

  const user = await prisma.user.update({
    where: { id: claim.user.id },
    data: {
      passwordHash,
      // Using the link is the proof that the address reaches them, which is the
      // only thing verification ever established.
      emailVerifiedAt: claim.user.emailVerifiedAt ?? new Date(),
    },
  });

  await createSession(user);
  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: claim.user.passwordHash ? "auth.password_reset" : "auth.account_activated",
    actorId: user.id,
    actorLabel: user.name,
    ipAddress: await clientIp(),
  });

  redirect(user.role === Role.EXTERNAL ? "/portal" : "/calendar");
}


export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/sign-in");
}
