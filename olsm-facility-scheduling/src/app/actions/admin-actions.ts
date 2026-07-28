"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ActivityType, Role, SeasonCode, TeamLevel } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { errorMessage } from "@/lib/errors";
import { localToInstant } from "@/lib/time";
import { requireAdmin, requirePermission, requireUser } from "@/lib/auth/current-user";
import { createStandingBlock, publishSeasonAllocation } from "@/services/allocation-service";
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

export async function updateUserRoleAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requirePermission("user:manage");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;

  if (!Object.values(Role).includes(role)) return { error: "Choose a valid role." };
  if (userId === actor.id) return { error: "You cannot change your own role." };

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

