"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ActivityType, Role, SeasonCode, TeamLevel } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { errorMessage } from "@/lib/errors";
import { env, emailIsDeliverable } from "@/lib/env";
import { localToInstant } from "@/lib/time";
import { requireAdmin, requirePermission, requireUser } from "@/lib/auth/current-user";
import { canAssignRole } from "@/lib/auth/rbac";
import { hashAccessToken, issueAccessToken } from "@/lib/auth/access-token";
import { createStandingBlock, publishSeasonAllocation } from "@/services/allocation-service";
import { enqueue } from "@/services/job-queue";
import type { Actor } from "@/services/booking-service";

export interface AdminFormState {
  error?: string;
  notice?: string;
}

async function adminActor(): Promise<Actor> {
  const user = await requireAdmin();
  const h = await headers();
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const ruleSchema = z.object({
  ruleId: z.string().min(1),
  requiresAdminApproval: z.coerce.boolean().optional(),
  requiresHeadCoachApproval: z.coerce.boolean().optional(),
  requiresContract: z.coerce.boolean().optional(),
  requiresWaiver: z.coerce.boolean().optional(),
  requiresCoi: z.coerce.boolean().optional(),
  requiresPayment: z.coerce.boolean().optional(),
  autoApprove: z.coerce.boolean().optional(),
  mhsaaComplianceFlag: z.coerce.boolean().optional(),
  priorityRank: z.coerce.number().int().min(1).max(999),
  refundFullDays: z.coerce.number().int().min(0).max(365),
  refundPartialDays: z.coerce.number().int().min(0).max(365),
  refundPartialPercent: z.coerce.number().int().min(0).max(100),
  documentHoldHours: z.coerce.number().int().min(1).max(2160),
  paymentHoldHours: z.coerce.number().int().min(1).max(2160),
});

export async function updateRuleAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("rules:manage");
  const raw = Object.fromEntries(formData);
  const parsed = ruleSchema.safeParse({
    ...raw,
    // Unchecked checkboxes are absent from FormData; coerce to false.
    requiresAdminApproval: raw.requiresAdminApproval === "on",
    requiresHeadCoachApproval: raw.requiresHeadCoachApproval === "on",
    requiresContract: raw.requiresContract === "on",
    requiresWaiver: raw.requiresWaiver === "on",
    requiresCoi: raw.requiresCoi === "on",
    requiresPayment: raw.requiresPayment === "on",
    autoApprove: raw.autoApprove === "on",
    mhsaaComplianceFlag: raw.mhsaaComplianceFlag === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }
  const { ruleId, ...data } = parsed.data;

  if (data.refundPartialDays > data.refundFullDays) {
    return { error: "The partial-refund window must be shorter than the full-refund window." };
  }

  const before = await prisma.rule.findUnique({ where: { id: ruleId } });
  if (!before) return { error: "That rule no longer exists." };

  await prisma.rule.update({ where: { id: ruleId }, data });

  // Rule edits change what future bookings require, so they are audited with a
  // full before/after. Bookings already created keep their frozen snapshot.
  await recordAudit({
    entityType: "rule",
    entityId: ruleId,
    action: "rule.updated",
    actorId: actor.id,
    actorLabel: actor.name,
    payload: {
      activityType: before.activityType,
      requesterRole: before.requesterRole,
      before: {
        requiresAdminApproval: before.requiresAdminApproval,
        requiresContract: before.requiresContract,
        requiresWaiver: before.requiresWaiver,
        requiresCoi: before.requiresCoi,
        requiresPayment: before.requiresPayment,
        autoApprove: before.autoApprove,
        priorityRank: before.priorityRank,
      },
      after: data,
    },
  });

  revalidatePath("/admin/rules");
  return { notice: "Rule updated. It applies to bookings created from now on." };
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const rateSchema = z.object({
  rateCardId: z.string().min(1),
  hourlyDollars: z.coerce.number().min(0).max(100_000),
  flatDayDollars: z.coerce.number().min(0).max(1_000_000).optional(),
  depositDollars: z.coerce.number().min(0).max(1_000_000).optional(),
  minHours: z.coerce.number().min(0.5).max(24),
});

export async function updateRateAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("rates:manage");
  const parsed = rateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }

  const { rateCardId, hourlyDollars, flatDayDollars, depositDollars, minHours } = parsed.data;
  const before = await prisma.rateCard.findUnique({ where: { id: rateCardId } });
  if (!before) return { error: "That rate card no longer exists." };

  await prisma.rateCard.update({
    where: { id: rateCardId },
    data: {
      hourlyCents: Math.round(hourlyDollars * 100),
      flatDayCents: flatDayDollars ? Math.round(flatDayDollars * 100) : null,
      depositCents: depositDollars ? Math.round(depositDollars * 100) : 0,
      minHours,
    },
  });

  await recordAudit({
    entityType: "facility",
    entityId: before.facilityId,
    action: "rate_card.updated",
    actorId: actor.id,
    actorLabel: actor.name,
    payload: {
      rateCardId,
      activityType: before.activityType,
      rateTier: before.rateTier,
      beforeHourlyCents: before.hourlyCents,
      afterHourlyCents: Math.round(hourlyDollars * 100),
    },
  });

  revalidatePath("/admin/rates");
  return { notice: "Rate updated. Invoices already issued are unchanged." };
}

// ---------------------------------------------------------------------------
// Facilities and sub-spaces
// ---------------------------------------------------------------------------

export async function updateFacilityAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await adminActor();
  const facilityId = String(formData.get("facilityId") ?? "");

  const bufferMinutes = Number(formData.get("bufferMinutes") ?? 0);
  const capacity = Number(formData.get("capacity") ?? 0);
  if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 240) {
    return { error: "Buffer minutes must be between 0 and 240." };
  }

  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) return { error: "That facility no longer exists." };

  await prisma.facility.update({
    where: { id: facilityId },
    data: {
      name: String(formData.get("name") ?? facility.name).trim() || facility.name,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : facility.capacity,
      bufferMinutes,
      externallyBookable: formData.get("externallyBookable") === "on",
      requiresSupervision: formData.get("requiresSupervision") === "on",
      googleCalendarId: String(formData.get("googleCalendarId") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      active: formData.get("active") === "on",
    },
  });

  await recordAudit({
    entityType: "facility",
    entityId: facilityId,
    action: "facility.updated",
    actorId: actor.id,
    actorLabel: actor.name,
    ipAddress: actor.ipAddress,
    payload: { name: facility.name, bufferMinutes },
  });

  revalidatePath("/admin/facilities");
  return { notice: `${facility.name} updated.` };
}

/** Edit the conflict graph: which sub-spaces this one physically occupies. */
export async function updateSubSpaceBlocksAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await adminActor();
  const subSpaceId = String(formData.get("subSpaceId") ?? "");
  const blocksIds = formData.getAll("blocksIds").map(String).filter(Boolean);

  if (blocksIds.includes(subSpaceId)) {
    return { error: "A space cannot block itself." };
  }

  const before = await prisma.subSpace.findUnique({ where: { id: subSpaceId } });
  if (!before) return { error: "That space no longer exists." };

  await prisma.subSpace.update({ where: { id: subSpaceId }, data: { blocksIds } });

  await recordAudit({
    entityType: "facility",
    entityId: before.facilityId,
    action: "sub_space.conflict_graph_updated",
    actorId: actor.id,
    actorLabel: actor.name,
    payload: { subSpaceId, before: before.blocksIds, after: blocksIds },
  });

  revalidatePath("/admin/facilities");
  return { notice: "Conflict rules updated. New bookings use them immediately." };
}

// ---------------------------------------------------------------------------
// Blackouts and maintenance
// ---------------------------------------------------------------------------

const blackoutSchema = z.object({
  facilityId: z.string().min(1),
  reason: z.string().trim().min(3, "Say why the space is unavailable."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function createBlackoutAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const user = await requirePermission("facility:mark-unavailable");
  const parsed = blackoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  const startAt = localToInstant(input.startDate, input.startTime);
  const endAt = localToInstant(input.endDate, input.endTime);
  if (endAt <= startAt) return { error: "The end must be after the start." };

  const blackout = await prisma.blackout.create({
    data: {
      facilityId: input.facilityId,
      startAt,
      endAt,
      reason: input.reason,
      createdById: user.id,
    },
  });

  await recordAudit({
    entityType: "blackout",
    entityId: blackout.id,
    action: "blackout.created",
    actorId: user.id,
    actorLabel: user.name,
    reason: input.reason,
    payload: { facilityId: input.facilityId, startAt: startAt.toISOString(), endAt: endAt.toISOString() },
  });

  // Existing confirmed bookings inside the window are not cancelled silently;
  // surface them so a human decides.
  const affected = await prisma.booking.count({
    where: {
      subSpace: { facilityId: input.facilityId },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      status: { in: ["CONFIRMED", "CHECKED_IN", "PENDING_APPROVAL", "AWAITING_DOCUMENTS", "AWAITING_PAYMENT"] },
    },
  });

  revalidatePath("/admin/blackouts");
  revalidatePath("/custodial");

  return {
    notice:
      affected > 0
        ? `Blackout created. ${affected} existing booking(s) fall inside it and were NOT cancelled — review them on the calendar.`
        : "Blackout created. The space is now unavailable for that window.",
  };
}

export async function deleteBlackoutAction(formData: FormData): Promise<void> {
  const user = await requirePermission("facility:mark-unavailable");
  const id = String(formData.get("blackoutId") ?? "");
  await prisma.blackout.deleteMany({ where: { id } });
  await recordAudit({
    entityType: "blackout",
    entityId: id,
    action: "blackout.deleted",
    actorId: user.id,
    actorLabel: user.name,
  });
  revalidatePath("/admin/blackouts");
}

// ---------------------------------------------------------------------------
// Seasons and allocation
// ---------------------------------------------------------------------------

export async function createSeasonAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requirePermission("season:manage");
  const name = String(formData.get("name") ?? "").trim();
  const seasonCode = String(formData.get("seasonCode") ?? "") as SeasonCode;
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");

  if (!name || !startDate || !endDate) return { error: "Name, start date and end date are required." };
  if (endDate <= startDate) return { error: "The season must end after it starts." };

  await prisma.season.create({
    data: {
      name,
      seasonCode,
      startDate: new Date(`${startDate}T00:00:00Z`),
      endDate: new Date(`${endDate}T00:00:00Z`),
    },
  });

  revalidatePath("/admin/allocation");
  return { notice: `${name} created. Add standing blocks, then review collisions before publishing.` };
}

export async function addStandingBlockAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await adminActor();

  const days = formData.getAll("days").map(String).filter(Boolean);
  if (days.length === 0) return { error: "Choose at least one day of the week." };

  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return { error: "Enter a start and end time." };
  }
  if (endTime <= startTime) return { error: "The block must end after it starts." };

  try {
    await createStandingBlock(
      {
        seasonId: String(formData.get("seasonId") ?? ""),
        sportId: String(formData.get("sportId") ?? ""),
        subSpaceId: String(formData.get("subSpaceId") ?? ""),
        teamLevel: (String(formData.get("teamLevel") ?? "VARSITY") as TeamLevel) ?? TeamLevel.VARSITY,
        rrule: `FREQ=WEEKLY;BYDAY=${days.join(",")}`,
        startTime,
        endTime,
        createdById: String(formData.get("createdById") ?? actor.id),
      },
      actor,
    );
  } catch (error) {
    return { error: errorMessage(error) };
  }

  revalidatePath("/admin/allocation");
  return { notice: "Standing block added. Review collisions before publishing the season." };
}

export async function publishSeasonAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await adminActor();
  const seasonId = String(formData.get("seasonId") ?? "");

  try {
    const result = await publishSeasonAllocation(seasonId, actor);
    revalidatePath("/admin/allocation");
    revalidatePath("/calendar");
    return {
      notice:
        `Published ${result.created} booking(s).` +
        (result.skipped.length > 0
          ? ` ${result.skipped.length} occurrence(s) were skipped — see the list below.`
          : ""),
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Add a person and email them a link to set a password.
 *
 * This is the only way an account comes into existence at runtime. Sign-in
 * through Entra or Google deliberately refuses to provision an unknown address
 * -- proving who you are in the tenant is not the same as being entitled to
 * book a gym -- so somebody has to do this deliberately, and it is recorded.
 */
const newUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: z.string().trim().max(40).optional(),
  role: z.nativeEnum(Role),
  organization: z.string().trim().max(120).optional(),
});

export async function createUserAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("user:invite");

  const parsed = newUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    role: formData.get("role"),
    organization: formData.get("organization") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }

  const input = parsed.data;

  // Nobody hands out authority they do not hold. The form only offers roles
  // this actor may assign, so reaching here means the request was forged.
  if (!canAssignRole(actor.role, input.role)) {
    return { error: "You cannot create an account with that role." };
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    // Say so plainly. This screen is behind an administrator's sign-in, so
    // there is no address to protect from an outsider here, and "that person is
    // already set up" is what the reader needs to know.
    return {
      error: existing.active
        ? `${existing.name} already has an account with that address.`
        : `That address belongs to a deactivated account (${existing.name}). Reactivate it instead of creating a second one.`,
    };
  }

  // Reuse an organization of the same name rather than making a second one --
  // duplicates split a club's bookings, insurance and invoices across two
  // records, which is exactly the mess the COI expiry sweep cannot see through.
  let organizationId: string | null = null;
  if (input.organization) {
    const org =
      (await prisma.organization.findFirst({
        where: { name: { equals: input.organization, mode: "insensitive" } },
      })) ??
      (await prisma.organization.create({
        data: { name: input.organization, type: "COMMERCIAL", rateTier: "COMMERCIAL" },
      }));
    organizationId = org.id;
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone || null,
      role: input.role,
      organizationId,
      // No password and no verified address until they use the link.
      passwordHash: null,
      emailVerifiedAt: null,
    },
  });

  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: "user.invited",
    actorId: actor.id,
    actorLabel: actor.name,
    toState: input.role,
    payload: { email: input.email, organization: input.organization ?? null },
  });

  const delivery = await sendSignInLink(user, actor.id);

  revalidatePath("/admin/users");
  return delivery.emailed
    ? { notice: `${user.name} has been added. A link to set a password is on its way to ${user.email}.` }
    : {
        notice:
          `${user.name} has been added, but no email provider is configured, so nothing was sent. ` +
          `Give them this link yourself — it works once and expires in seven days: ${delivery.url}`,
      };
}

/**
 * Send a fresh link to somebody who never used theirs, or who is locked out.
 *
 * This is the password reset. There is no self-service version: for fifty known
 * people, asking the athletic office is a smaller and safer system than an
 * unauthenticated endpoint that emails whoever types an address into it.
 */
export async function sendSignInLinkAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("user:invite");
  const userId = String(formData.get("userId") ?? "");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "That person no longer exists." };
  if (!user.active) return { error: "Reactivate the account before sending a sign-in link." };

  const delivery = await sendSignInLink(user, actor.id);

  await recordAudit({
    entityType: "user",
    entityId: user.id,
    action: "user.sign_in_link_sent",
    actorId: actor.id,
    actorLabel: actor.name,
    payload: { email: user.email, emailed: delivery.emailed },
  });

  revalidatePath("/admin/users");
  return delivery.emailed
    ? { notice: `A new link is on its way to ${user.email}. Any earlier link has stopped working.` }
    : {
        notice:
          `No email provider is configured, so nothing was sent. Give them this link yourself — ` +
          `it works once and expires in seven days: ${delivery.url}`,
      };
}

/**
 * Issue the link and try to mail it.
 *
 * When no provider is configured the URL comes back for the administrator to
 * pass on by hand. That does put a credential on screen, so it is deliberately
 * narrow: it happens only when email cannot work at all, only for somebody who
 * already holds `user:invite`, and it is the alternative to the invitation
 * failing silently -- which is how a pilot ends up with accounts nobody can
 * reach and no sign that anything went wrong.
 */
async function sendSignInLink(
  user: { id: string; name: string; email: string; passwordHash: string | null },
  issuedById: string,
): Promise<{ emailed: boolean; url: string }> {
  const token = await issueAccessToken({ userId: user.id, issuedById });
  const url = `${env.appUrl}/set-password/${token}`;
  const returning = Boolean(user.passwordHash);

  if (!emailIsDeliverable()) return { emailed: false, url };

  await enqueue({
    kind: "notify.email",
    payload: {
      to: user.email,
      subject: returning
        ? "Set a new password for OLSM facility scheduling"
        : "Your OLSM facility scheduling account",
      text: returning
        ? `${user.name},\n\nSomeone at the OLSM athletic office sent you a link to set a new ` +
          `password:\n${url}\n\nIt works once and expires in seven days. If you did not ask for ` +
          `it, you can ignore this — your current password still works until the link is used.\n`
        : `${user.name},\n\nAn account has been set up for you to reserve OLSM facilities. ` +
          `Choose a password here:\n${url}\n\nIt works once and expires in seven days. If it has ` +
          `expired by the time you get to it, ask the athletic office to send another.\n`,
    },
    // Unique per issuance. Keying on the user would let the queue treat a
    // resend as a duplicate of the link they told us never arrived.
    idempotencyKey: `signin-link:${hashAccessToken(token).slice(0, 24)}`,
  });

  return { emailed: true, url };
}

export async function updateUserRoleAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("user:manage");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;

  if (!Object.values(Role).includes(role)) return { error: "Choose a valid role." };
  if (userId === actor.id) return { error: "You cannot change your own role." };
  if (!canAssignRole(actor.role, role)) {
    return { error: "You cannot give somebody a role above your own." };
  }

  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) return { error: "That user no longer exists." };

  await prisma.user.update({
    where: { id: userId },
    data: { role, active: formData.get("active") === "on" },
  });

  await recordAudit({
    entityType: "user",
    entityId: userId,
    action: "user.role_changed",
    actorId: actor.id,
    actorLabel: actor.name,
    fromState: before.role,
    toState: role,
  });

  revalidatePath("/admin/users");
  return { notice: `${before.name} is now ${role.replace("_", " ").toLowerCase()}.` };
}


// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export async function cancelForWeatherAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await adminActor();
  const facilityId = String(formData.get("facilityId") ?? "");
  const date = String(formData.get("date") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  try {
    const { cancelForWeather } = await import("@/services/weather-service");
    const result = await cancelForWeather(facilityId, date, reason, actor);

    revalidatePath("/admin/weather");
    revalidatePath("/calendar");
    revalidatePath("/custodial");

    const parts = [`${result.cancelled} booking(s) cancelled`];
    if (result.refundedCents > 0) parts.push(`${(result.refundedCents / 100).toFixed(2)} USD refunded`);
    parts.push(`${result.emailsSent} emailed`);
    if (result.smsSent > 0) parts.push(`${result.smsSent} texted`);
    if (result.failed.length > 0) {
      parts.push(
        `${result.failed.length} could not be cancelled (${result.failed.map((f) => f.reference).join(", ")}) — handle these by hand`,
      );
    }

    return { notice: `${parts.join(", ")}.` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export async function releaseDepositAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("invoice:refund");
  const invoiceId = String(formData.get("invoiceId") ?? "");

  try {
    const { releaseHeldDeposit } = await import("@/services/deposit-service");
    await releaseHeldDeposit(invoiceId, actor);
    revalidatePath(`/portal/invoices/${invoiceId}`);
    return { notice: "Deposit released in full. The renter has been told." };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function captureDepositAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("invoice:refund");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const dollars = Number(formData.get("amountDollars") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { error: "Enter the amount to keep." };
  }

  try {
    const { captureHeldDeposit } = await import("@/services/deposit-service");
    await captureHeldDeposit(invoiceId, Math.round(dollars * 100), reason, actor);
    revalidatePath(`/portal/invoices/${invoiceId}`);
    return { notice: "Deposit captured and the balance released. The renter has been told why." };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
