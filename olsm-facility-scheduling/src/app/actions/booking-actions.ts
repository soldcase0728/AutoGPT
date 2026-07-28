"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ActivityType, TeamLevel } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser, requireAdmin, requireUser } from "@/lib/auth/current-user";
import { ComplianceError, ConflictError, errorMessage, isDomainError } from "@/lib/errors";
import { localToInstant } from "@/lib/time";
import type { BumpCandidate } from "@/domain/priority";
import {
  cancelBooking,
  checkIn,
  createBooking,
  decideApproval,
  markNoShow,
  releaseStandingBlockOccurrence,
  type Actor,
} from "@/services/booking-service";
import { joinWaitlist } from "@/services/waitlist-service";

export interface BookingFormState {
  error?: string;
  /** Rendered as a link when the block is a compliance gate. */
  action?: { label: string; href: string };
  notice?: string;
  bookingId?: string;
  status?: string;
  warnings?: string[];
  /** Present when an admin must confirm a bump before the request can proceed. */
  bumpable?: { reference: string; title: string; requesterName: string }[];
  invoiceId?: string;
}

async function actorFromSession(): Promise<Actor> {
  const user = await requireUser();
  const h = await headers();
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

const bookingSchema = z.object({
  subSpaceId: z.string().min(1, "Choose a space."),
  activityType: z.nativeEnum(ActivityType),
  title: z.string().trim().min(3, "Give the booking a short title."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Choose a start time."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Choose an end time."),
  headcount: z.coerce.number().int().min(0).max(10_000).optional(),
  sportId: z.string().optional(),
  teamLevel: z.nativeEnum(TeamLevel).optional(),
  supervisorId: z.string().optional(),
  setupNotes: z.string().max(2000).optional(),
  equipmentNotes: z.string().max(2000).optional(),
  requesterId: z.string().optional(),
  overrideAvailability: z.coerce.boolean().optional(),
  confirmBump: z.coerce.boolean().optional(),
});

export async function createBookingAction(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const actor = await actorFromSession();
  const parsed = bookingSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  if (input.endTime <= input.startTime) {
    return { error: "The end time must be after the start time." };
  }

  // Booking on someone else's behalf is an admin action.
  let requesterId = actor.id;
  if (input.requesterId && input.requesterId !== actor.id) {
    await requireAdmin();
    requesterId = input.requesterId;
  }

  try {
    const result = await createBooking(
      {
        requesterId,
        subSpaceId: input.subSpaceId,
        activityType: input.activityType,
        title: input.title,
        startAt: localToInstant(input.date, input.startTime),
        endAt: localToInstant(input.date, input.endTime),
        headcount: input.headcount ?? 0,
        sportId: input.sportId || null,
        teamLevel: input.teamLevel ?? TeamLevel.NONE,
        supervisorId: input.supervisorId || null,
        setupNotes: input.setupNotes || null,
        equipmentNotes: input.equipmentNotes || null,
        overrideAvailability: input.overrideAvailability,
        confirmBump: input.confirmBump,
      },
      actor,
    );

    revalidatePath("/calendar");
    revalidatePath("/portal");
    revalidatePath("/admin/approvals");

    return {
      notice: describeOutcome(result.status),
      bookingId: result.booking.id,
      status: result.status,
      warnings: result.warnings,
      invoiceId: result.invoiceId,
    };
  } catch (error) {
    if (error instanceof ComplianceError) {
      return {
        error: error.message,
        action:
          error.actionLabel && error.actionHref
            ? { label: error.actionLabel, href: error.actionHref }
            : undefined,
      };
    }

    if (error instanceof ConflictError) {
      const details = error.details as { bumpable?: BumpCandidate[]; requiresConfirmation?: boolean } | undefined;
      return {
        error: error.message,
        bumpable: details?.requiresConfirmation
          ? details.bumpable?.map((b) => ({
              reference: b.reference,
              title: b.title,
              requesterName: b.requesterName,
            }))
          : undefined,
      };
    }

    if (isDomainError(error)) return { error: error.message };
    console.error("createBookingAction", error);
    return { error: "Something went wrong creating that booking." };
  }
}

export async function approveAction(formData: FormData): Promise<void> {
  const actor = await actorFromSession();
  const stepId = String(formData.get("stepId") ?? "");
  const decision = String(formData.get("decision") ?? "") === "DENIED" ? "DENIED" : "APPROVED";
  const note = String(formData.get("note") ?? "").trim() || undefined;

  await decideApproval(stepId, decision, actor, note);
  revalidatePath("/admin/approvals");
  revalidatePath("/calendar");
}

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const actor = await actorFromSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Cancelled by the requester.";
  const waive = String(formData.get("waivePolicy") ?? "") === "on";

  if (waive) await requireAdmin();

  await cancelBooking(bookingId, reason, actor, { waiveCancellationPolicy: waive });
  revalidatePath("/calendar");
  revalidatePath("/portal");
}

export async function releaseBlockAction(formData: FormData): Promise<void> {
  const actor = await actorFromSession();
  await releaseStandingBlockOccurrence(String(formData.get("bookingId") ?? ""), actor);
  revalidatePath("/my-team");
  revalidatePath("/calendar");
}

export async function checkInAction(formData: FormData): Promise<void> {
  const actor = await actorFromSession();
  await checkIn(String(formData.get("bookingId") ?? ""), actor);
  revalidatePath("/custodial");
  revalidatePath("/calendar");
}

export async function markNoShowAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const actor = await actorFromSession();
  await markNoShow(String(formData.get("bookingId") ?? ""), actor);
  revalidatePath("/calendar");
}

export async function joinWaitlistAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await joinWaitlist({
    subSpaceId: String(formData.get("subSpaceId") ?? ""),
    userId: user.id,
    windowStart: localToInstant(String(formData.get("date")), String(formData.get("startTime"))),
    windowEnd: localToInstant(String(formData.get("date")), String(formData.get("endTime"))),
    activityType: formData.get("activityType") as ActivityType,
  });
  revalidatePath("/calendar");
}

function describeOutcome(status: string): string {
  switch (status) {
    case "CONFIRMED":
      return "Confirmed. It is on the facility calendar now.";
    case "PENDING_APPROVAL":
      return "Submitted for approval. The slot is held for you while it is reviewed.";
    case "AWAITING_DOCUMENTS":
      return "Approved. Sign the outstanding documents and upload your certificate of insurance.";
    case "AWAITING_PAYMENT":
      return "Documents are complete. Pay the invoice to confirm the booking.";
    default:
      return `Booking created (${status}).`;
  }
}

