"use server";

import { headers } from "next/headers";
import { ActivityType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { errorMessage, isDomainError } from "@/lib/errors";
import { localToInstant } from "@/lib/time";
import { randomToken } from "@/lib/auth/password";
import { getCurrentUser } from "@/lib/auth/current-user";
import { EXTERNAL_ACTIVITY_TYPES } from "@/domain/rules-engine";
import { createBooking } from "@/services/booking-service";
import { enqueue } from "@/services/job-queue";
import { env } from "@/lib/env";

export interface RequestFormState {
  error?: string;
  notice?: string;
  submitted?: boolean;
}

const schema = z.object({
  subSpaceId: z.string().min(1),
  activityType: z.nativeEnum(ActivityType),
  title: z.string().trim().min(3, "Describe what the booking is for."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  headcount: z.coerce.number().int().min(1, "Tell us how many people to expect."),
  setupNotes: z.string().max(2000).optional(),
  name: z.string().trim().optional(),
  email: z.string().email().optional(),
  phone: z.string().trim().optional(),
  organization: z.string().trim().optional(),
});

/**
 * The public request path. An unknown requester gets an EXTERNAL account
 * created for them so they have somewhere to sign documents and pay -- but the
 * role is fixed, never taken from the form.
 */
export async function submitExternalRequestAction(
  _prev: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  if (!EXTERNAL_ACTIVITY_TYPES.includes(input.activityType)) {
    return { error: "That type of use cannot be requested through this form." };
  }
  if (input.endTime <= input.startTime) {
    return { error: "The end time must be after the start time." };
  }

  const h = await headers();
  const ipAddress = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const signedIn = await getCurrentUser();
  let requester = signedIn;

  if (!requester) {
    if (!input.email || !input.name) {
      return { error: "Enter your name and email address so we can reach you." };
    }

    const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });

    if (existing) {
      // Do not let an anonymous form act as an existing account.
      if (existing.role !== Role.EXTERNAL) {
        return {
          error: "That address belongs to an OLSM staff account. Sign in and book from the staff tools.",
        };
      }
      requester = await prisma.user.findUniqueOrThrow({
        where: { id: existing.id },
        include: { sports: { include: { sport: true } }, organization: true },
      });
    } else {
      const organization = input.organization
        ? await prisma.organization.create({
            data: { name: input.organization, type: "COMMERCIAL", rateTier: "COMMERCIAL" },
          })
        : null;

      const created = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email.toLowerCase(),
          phone: input.phone || null,
          role: Role.EXTERNAL,
          organizationId: organization?.id ?? null,
        },
      });

      await recordAudit({
        entityType: "user",
        entityId: created.id,
        action: "user.created_from_request",
        actorLabel: input.name,
        ipAddress,
        payload: { email: input.email, organization: input.organization ?? null },
      });

      // Give them a way in without a password: a one-time sign-in link.
      const token = randomToken(24);
      await prisma.session.create({
        data: { id: token, userId: created.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
      });
      await enqueue({
        kind: "notify.email",
        payload: {
          to: created.email,
          subject: "Your OLSM facility request",
          text:
            `${created.name},\n\nWe have received your facility request. Track it, sign documents ` +
            `and pay here:\n${env.appUrl}/verify/${token}\n\nThis link is good for 7 days.`,
        },
        idempotencyKey: `request-link:${created.id}:${token}`,
      });

      requester = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
        include: { sports: { include: { sport: true } }, organization: true },
      });
    }
  }

  try {
    await createBooking(
      {
        requesterId: requester.id,
        subSpaceId: input.subSpaceId,
        activityType: input.activityType,
        title: input.title,
        startAt: localToInstant(input.date, input.startTime),
        endAt: localToInstant(input.date, input.endTime),
        headcount: input.headcount,
        setupNotes: input.setupNotes || null,
      },
      { id: requester.id, name: requester.name, role: requester.role, ipAddress },
    );
  } catch (error) {
    if (isDomainError(error)) return { error: errorMessage(error) };
    console.error("submitExternalRequestAction", error);
    return { error: "Something went wrong submitting that request." };
  }

  return {
    submitted: true,
    notice:
      "The athletic office has your request and the slot is held. You will hear back by email, " +
      "and we will then ask for your agreement, waiver, certificate of insurance and payment.",
  };
}
