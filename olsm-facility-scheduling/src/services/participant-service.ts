/**
 * Participant waivers.
 *
 * The requester signing a release covers the requester. It does not cover the
 * forty children on the floor, which is the population the school is actually
 * exposed to. This module collects one signed waiver per participant, by either
 * of the two routes the brief allows:
 *
 *   1. Roster upload  -- the organizer pastes or uploads names and emails, and
 *      each participant gets their own signing link.
 *   2. Public link    -- one unguessable URL per booking that participants open
 *      and sign themselves.
 *
 * Timing is deliberately different from the other document gates. Contracts,
 * COIs and payment block CONFIRMED. Participant waivers cannot: a camp confirms
 * in March and fills its roster in June. They block the *event*, so they are
 * enforced by pre-event warnings and a day-of check rather than by the booking
 * state machine.
 */

import { DocumentStatus, DocumentType, Prisma, type Document } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { randomToken } from "@/lib/auth/password";
import { formatRange } from "@/lib/time";
import { enqueue } from "./job-queue";
import type { Actor } from "./booking-service";

/** Activity types where the people on the floor are not the requester. */
const ROSTER_ACTIVITY_TYPES = [
  "SCHOOL_CAMP",
  "PRIVATE_INSTRUCTION",
  "CLUB_TRAVEL",
  "EXTERNAL_RENTAL",
] as const;

export function needsParticipantWaivers(activityType: string): boolean {
  return (ROSTER_ACTIVITY_TYPES as readonly string[]).includes(activityType);
}

// ---------------------------------------------------------------------------
// The public link
// ---------------------------------------------------------------------------

/** Mint (or return) the booking's public waiver link. */
export async function ensureWaiverToken(bookingId: string, actor: Actor): Promise<string> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundError("Booking");
  if (booking.waiverToken) return booking.waiverToken;

  const token = randomToken(24);
  await prisma.booking.update({ where: { id: bookingId }, data: { waiverToken: token } });

  await recordAudit({
    entityType: "booking",
    entityId: bookingId,
    action: "waiver.link_created",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
  });

  return token;
}

export function waiverUrl(token: string): string {
  return `${env.appUrl}/waiver/${token}`;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface RosterEntry {
  name: string;
  email?: string;
  isMinor: boolean;
  guardianName?: string;
  guardianEmail?: string;
}

/**
 * Parse a pasted or uploaded roster. Accepts CSV or one-per-line, with an
 * optional header. Tolerant on purpose -- an organizer pasting from a
 * spreadsheet should not have to fight a format.
 *
 * Columns: name, email, minor (yes/no), guardian name, guardian email
 */
export function parseRoster(raw: string): { entries: RosterEntry[]; errors: string[] } {
  const entries: RosterEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const [i, line] of lines.entries()) {
    const cells = line.split(/[,\t]/).map((c) => c.trim());

    // Skip a header row.
    if (i === 0 && /^(name|participant|full name)$/i.test(cells[0] ?? "")) continue;

    const [name, email, minorRaw, guardianName, guardianEmail] = cells;
    if (!name) continue;

    if (name.length < 2) {
      errors.push(`Line ${i + 1}: "${name}" is too short to be a name.`);
      continue;
    }

    const key = `${name.toLowerCase()}|${(email ?? "").toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`Line ${i + 1}: ${name} appears more than once; the duplicate was skipped.`);
      continue;
    }
    seen.add(key);

    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`Line ${i + 1}: "${email}" does not look like an email address.`);
      continue;
    }

    const isMinor = /^(y|yes|true|minor|1)$/i.test(minorRaw ?? "");

    // A minor with no guardian cannot produce a valid waiver, so this is an
    // error rather than something to discover at signing time.
    if (isMinor && !guardianName) {
      errors.push(`Line ${i + 1}: ${name} is marked as a minor but has no parent or guardian named.`);
      continue;
    }

    entries.push({
      name,
      email: email || undefined,
      isMinor,
      guardianName: guardianName || undefined,
      guardianEmail: guardianEmail || email || undefined,
    });
  }

  return { entries, errors };
}

export interface RosterResult {
  created: number;
  skipped: number;
  invited: number;
}

/** Create one waiver document per roster entry and email each a signing link. */
export async function addRoster(
  bookingId: string,
  entries: readonly RosterEntry[],
  actor: Actor,
): Promise<RosterResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { subSpace: { include: { facility: true } } },
  });
  if (!booking) throw new NotFoundError("Booking");
  if (entries.length === 0) throw new ValidationError("The roster is empty.");

  const existing = await prisma.document.findMany({
    where: { bookingId, isParticipant: true },
    select: { signerName: true, signerEmail: true },
  });
  const already = new Set(
    existing.map((d) => `${(d.signerName ?? "").toLowerCase()}|${(d.signerEmail ?? "").toLowerCase()}`),
  );

  let created = 0;
  let skipped = 0;
  let invited = 0;

  for (const entry of entries) {
    const key = `${entry.name.toLowerCase()}|${(entry.email ?? "").toLowerCase()}`;
    if (already.has(key)) {
      skipped += 1;
      continue;
    }

    const token = randomToken(24);
    await prisma.document.create({
      data: {
        bookingId,
        type: entry.isMinor
          ? DocumentType.MINOR_PARTICIPANT_WAIVER
          : DocumentType.LIABILITY_WAIVER,
        status: DocumentStatus.NOT_STARTED,
        provider: "manual",
        isParticipant: true,
        isMinor: entry.isMinor,
        signerName: entry.name,
        signerEmail: entry.email ?? null,
        guardianName: entry.guardianName ?? null,
        guardianEmail: entry.guardianEmail ?? null,
        publicToken: token,
      },
    });
    created += 1;

    // Minors are chased through the guardian, not the child.
    const recipient = entry.isMinor ? entry.guardianEmail : entry.email;
    if (recipient) {
      await enqueue({
        kind: "notify.email",
        payload: {
          to: recipient,
          subject: `Sign the liability waiver for ${booking.title}`,
          text:
            `${entry.isMinor ? `${entry.guardianName},\n\nA waiver is needed for ${entry.name}` : `${entry.name},`}\n\n` +
            `${booking.title}\n${booking.subSpace.facility.name} — ${booking.subSpace.name}\n` +
            `${formatRange(booking.startAt, booking.endAt)}\n\n` +
            `Everyone using an OLSM facility signs a release. It takes a minute:\n` +
            `${env.appUrl}/sign/${token}\n\n` +
            "This must be signed before the activity takes place.",
        },
        idempotencyKey: `participant-waiver:${bookingId}:${token}`,
      });
      invited += 1;
    }
  }

  await recordAudit({
    entityType: "booking",
    entityId: bookingId,
    action: "waiver.roster_added",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    payload: { created, skipped, invited, total: entries.length },
  });

  return { created, skipped, invited };
}

/** A participant signing themselves through the booking's public link. */
export async function selfRegisterParticipant(
  waiverToken: string,
  entry: RosterEntry,
  ipAddress: string | null,
): Promise<Document> {
  const booking = await prisma.booking.findUnique({ where: { waiverToken } });
  if (!booking) throw new NotFoundError("Booking");

  if (booking.endAt < new Date()) {
    throw new ValidationError("That activity has already finished.");
  }
  if (["CANCELLED", "DENIED", "EXPIRED"].includes(booking.status)) {
    throw new ValidationError("That booking is no longer going ahead.");
  }
  if (entry.isMinor && !entry.guardianName) {
    throw new ValidationError("A parent or guardian must be named to sign for a minor.");
  }

  // Signing twice is a duplicate, not a second participant.
  const existing = await prisma.document.findFirst({
    where: {
      bookingId: booking.id,
      isParticipant: true,
      signerName: { equals: entry.name, mode: "insensitive" },
      ...(entry.email ? { signerEmail: { equals: entry.email, mode: "insensitive" } } : {}),
    },
  });

  const document =
    existing ??
    (await prisma.document.create({
      data: {
        bookingId: booking.id,
        type: entry.isMinor
          ? DocumentType.MINOR_PARTICIPANT_WAIVER
          : DocumentType.LIABILITY_WAIVER,
        status: DocumentStatus.NOT_STARTED,
        provider: "manual",
        isParticipant: true,
        isMinor: entry.isMinor,
        signerName: entry.name,
        signerEmail: entry.email ?? null,
        guardianName: entry.guardianName ?? null,
        guardianEmail: entry.guardianEmail ?? null,
        publicToken: randomToken(24),
      },
    }));

  if (document.status === DocumentStatus.SIGNED) return document;

  const signed = await prisma.document.update({
    where: { id: document.id },
    data: {
      status: DocumentStatus.SIGNED,
      signedAt: new Date(),
      guardianName: entry.guardianName ?? document.guardianName,
      guardianEmail: entry.guardianEmail ?? document.guardianEmail,
    },
  });

  await recordAudit({
    entityType: "document",
    entityId: document.id,
    action: "waiver.participant_signed",
    actorLabel: entry.isMinor ? `${entry.guardianName} (for ${entry.name})` : entry.name,
    toState: DocumentStatus.SIGNED,
    ipAddress,
    payload: {
      bookingId: booking.id,
      participantName: entry.name,
      isMinor: entry.isMinor,
      guardianName: entry.guardianName ?? null,
      selfRegistered: true,
    },
  });

  return signed;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface RosterStatus {
  expected: number;
  onRoster: number;
  signed: number;
  outstanding: number;
  complete: boolean;
  /** True when the headcount says more people are coming than have signed. */
  shortOfHeadcount: boolean;
  participants: {
    id: string;
    name: string;
    email: string | null;
    isMinor: boolean;
    guardianName: string | null;
    signed: boolean;
    signingUrl: string | null;
  }[];
}

export async function rosterStatus(bookingId: string): Promise<RosterStatus> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { documents: { where: { isParticipant: true }, orderBy: { signerName: "asc" } } },
  });
  if (!booking) throw new NotFoundError("Booking");

  const participants = booking.documents.map((d) => ({
    id: d.id,
    name: d.signerName ?? "Unnamed",
    email: d.signerEmail,
    isMinor: d.isMinor,
    guardianName: d.guardianName,
    signed: d.status === DocumentStatus.SIGNED,
    signingUrl: d.publicToken ? `${env.appUrl}/sign/${d.publicToken}` : null,
  }));

  const signed = participants.filter((p) => p.signed).length;
  const expected = booking.headcount || 0;

  return {
    expected,
    onRoster: participants.length,
    signed,
    outstanding: participants.length - signed,
    complete: participants.length > 0 && signed === participants.length,
    shortOfHeadcount: expected > 0 && signed < expected,
    participants,
  };
}

/**
 * Bookings taking place soon whose participant waivers are incomplete.
 * Drives the pre-event nudge and gives the athletic office a list to chase.
 */
export async function bookingsMissingWaivers(withinHours = 72, now: Date = new Date()) {
  const horizon = new Date(now.getTime() + withinHours * 3_600_000);

  const bookings = await prisma.booking.findMany({
    where: {
      startAt: { gte: now, lte: horizon },
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      activityType: { in: [...ROSTER_ACTIVITY_TYPES] as never },
    },
    include: {
      requester: true,
      subSpace: { include: { facility: true } },
      documents: { where: { isParticipant: true } },
    },
  });

  return bookings
    .map((booking) => {
      const signed = booking.documents.filter((d) => d.status === DocumentStatus.SIGNED).length;
      const expected = booking.headcount || booking.documents.length;
      return { booking, signed, expected, missing: Math.max(0, expected - signed) };
    })
    .filter((row) => row.missing > 0);
}

/** Nudge organizers whose events are close and whose rosters are short. */
export async function sendWaiverReminders(withinHours = 72): Promise<number> {
  const rows = await bookingsMissingWaivers(withinHours);
  let sent = 0;

  for (const { booking, signed, missing } of rows) {
    const token = booking.waiverToken;
    const link = token
      ? waiverUrl(token)
      : `${env.appUrl}/portal/bookings/${booking.id}`;

    await enqueue({
      kind: "notify.email",
      payload: {
        to: booking.requester.email,
        subject: `${missing} waiver${missing === 1 ? "" : "s"} outstanding for ${booking.title}`,
        text:
          `${booking.requester.name},\n\n` +
          `${booking.title} is on ${formatRange(booking.startAt, booking.endAt)} at ` +
          `${booking.subSpace.facility.name}.\n\n` +
          `${signed} of ${signed + missing} participants have signed a release. ` +
          `Everyone using the facility needs one.\n\n` +
          `Share this link with the rest of your group:\n${link}\n\n` +
          "You can also add them by name from your booking page.",
      },
      idempotencyKey: `waiver-reminder:${booking.id}:${booking.startAt.toISOString().slice(0, 10)}`,
    });
    sent += 1;
  }

  return sent;
}

export function rosterTemplate(): string {
  return [
    "name,email,minor,guardian name,guardian email",
    "Jane Smith,jane@example.com,no,,",
    "Sam Smith,,yes,Jane Smith,jane@example.com",
  ].join("\n");
}
