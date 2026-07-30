"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { requireUser } from "@/lib/auth/current-user";
import { isAdmin } from "@/lib/auth/rbac";
import {
  addRoster,
  ensureWaiverToken,
  parseRoster,
  selfRegisterParticipant,
  waiverUrl,
} from "@/services/participant-service";
import type { Actor } from "@/services/booking-service";

export interface RosterFormState {
  error?: string;
  notice?: string;
  warnings?: string[];
  waiverLink?: string;
}

async function actorFor(bookingId: string): Promise<Actor> {
  const user = await requireUser();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error("Booking not found.");

  // Only the organizer or an administrator manages a roster.
  if (booking.requesterId !== user.id && !isAdmin(user.role)) {
    throw new Error("You cannot manage the roster for that booking.");
  }

  const h = await headers();
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

export async function createWaiverLinkAction(
  _prev: RosterFormState,
  formData: FormData,
): Promise<RosterFormState> {
  const bookingId = String(formData.get("bookingId") ?? "");
  try {
    const actor = await actorFor(bookingId);
    const token = await ensureWaiverToken(bookingId, actor);
    revalidatePath(`/portal/bookings/${bookingId}`);
    return {
      notice: "Share this link with your group. Anyone who opens it can sign for themselves.",
      waiverLink: waiverUrl(token),
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function addRosterAction(
  _prev: RosterFormState,
  formData: FormData,
): Promise<RosterFormState> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const pasted = String(formData.get("roster") ?? "").trim();
  const file = formData.get("file");

  let raw = pasted;
  if (!raw && file instanceof File && file.size > 0) {
    if (file.size > 1024 * 1024) return { error: "That roster file is larger than 1 MB." };
    raw = await file.text();
  }

  if (!raw) return { error: "Paste a roster or choose a CSV file." };

  const { entries, errors } = parseRoster(raw);
  if (entries.length === 0) {
    return {
      error: "No usable rows were found in that roster.",
      warnings: errors.slice(0, 10),
    };
  }

  try {
    const actor = await actorFor(bookingId);
    const result = await addRoster(bookingId, entries, actor);
    revalidatePath(`/portal/bookings/${bookingId}`);

    const parts = [`${result.created} participant${result.created === 1 ? "" : "s"} added`];
    if (result.invited > 0) parts.push(`${result.invited} emailed a signing link`);
    if (result.skipped > 0) parts.push(`${result.skipped} already on the roster`);

    return { notice: `${parts.join(", ")}.`, warnings: errors.slice(0, 10) };
  } catch (error) {
    return { error: errorMessage(error), warnings: errors.slice(0, 10) };
  }
}

export interface PublicWaiverState {
  error?: string;
  signedName?: string;
}

/** Public: a participant signing through the booking's shared link. */
export async function signPublicWaiverAction(
  _prev: PublicWaiverState,
  formData: FormData,
): Promise<PublicWaiverState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const isMinor = formData.get("isMinor") === "on";
  const guardianName = String(formData.get("guardianName") ?? "").trim();
  const guardianEmail = String(formData.get("guardianEmail") ?? "").trim();
  const agreed = formData.get("agree") === "on";

  if (!agreed) return { error: "You must accept the release to sign." };
  if (name.length < 2) return { error: "Enter the participant's full name." };
  if (isMinor && guardianName.length < 2) {
    return { error: "A parent or guardian must type their own name to sign for a minor." };
  }

  const h = await headers();

  try {
    await selfRegisterParticipant(
      token,
      {
        name,
        email: email || undefined,
        isMinor,
        guardianName: guardianName || undefined,
        guardianEmail: guardianEmail || email || undefined,
      },
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    );
    return { signedName: name };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
