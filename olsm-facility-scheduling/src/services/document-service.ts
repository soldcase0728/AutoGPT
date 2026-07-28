/**
 * Documents: annual agreements, contracts, waivers and certificates of
 * insurance.
 *
 * Document rows are created up front in NOT_STARTED so the requester portal can
 * show "here is what you owe" before anything is sent. Sending moves them to
 * SENT; the provider webhook moves them to SIGNED and re-advances the booking.
 */

import {
  DocumentStatus,
  DocumentType,
  Prisma,
  type Document,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { randomToken } from "@/lib/auth/password";
import { agreementExpiryFor, DOCUMENT_LABELS } from "@/domain/compliance";
import { formatMoney } from "@/domain/pricing";
import { formatDateTime } from "@/lib/time";
import { esignProvider, type EnvelopeFields } from "@/integrations/esign";
import { documentKey, storage } from "@/integrations/storage";
import type { Actor } from "./booking-service";

/** Create the placeholder rows for a booking's required documents. */
export async function prepareBookingDocuments(
  bookingId: string,
  types: readonly DocumentType[],
): Promise<Document[]> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { requester: true, organization: true },
  });
  if (!booking) throw new NotFoundError("Booking");

  const created: Document[] = [];

  for (const type of types) {
    if (type === DocumentType.CERTIFICATE_OF_INSURANCE) {
      // A COI already on file for the organisation satisfies the gate; do not
      // ask a club for the same certificate every booking.
      const existing = await prisma.document.findFirst({
        where: {
          organizationId: booking.organizationId ?? undefined,
          type,
          status: { in: [DocumentStatus.UPLOADED, DocumentStatus.SIGNED] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: booking.endAt } }],
        },
      });
      if (existing) {
        // Attach a copy to this booking so the gate check sees it locally.
        created.push(
          await prisma.document.create({
            data: {
              bookingId,
              organizationId: booking.organizationId,
              userId: booking.requesterId,
              type,
              provider: existing.provider,
              status: existing.status,
              fileUrl: existing.fileUrl,
              expiresAt: existing.expiresAt,
              signedAt: existing.signedAt,
              metadata: { copiedFromDocumentId: existing.id } as Prisma.InputJsonValue,
            },
          }),
        );
        continue;
      }
    }

    created.push(
      await prisma.document.create({
        data: {
          bookingId,
          organizationId: booking.organizationId,
          userId: booking.requesterId,
          type,
          status: DocumentStatus.NOT_STARTED,
          signerEmail: booking.requester.email,
          signerName: booking.requester.name,
          provider: env.esign.provider,
        },
      }),
    );
  }

  await recordAudit({
    entityType: "booking",
    entityId: bookingId,
    action: "documents.prepared",
    actorLabel: "system",
    payload: { types: types as unknown as Prisma.InputJsonValue },
  });

  return created;
}

/** Send a prepared document to the signer. */
export async function sendDocument(documentId: string, actor: Actor): Promise<Document> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      booking: {
        include: {
          subSpace: { include: { facility: true } },
          organization: true,
          invoices: true,
        },
      },
      user: true,
    },
  });
  if (!document) throw new NotFoundError("Document");
  if (document.status === DocumentStatus.SIGNED) {
    throw new ValidationError("That document is already signed.");
  }
  if (document.type === DocumentType.CERTIFICATE_OF_INSURANCE) {
    throw new ValidationError("A certificate of insurance is uploaded, not sent for signature.");
  }

  const provider = esignProvider();
  const booking = document.booking;
  const invoiceTotal = booking?.invoices?.[0]?.totalCents ?? 0;

  const fields: EnvelopeFields = {
    requesterName: document.signerName ?? document.user?.name ?? "",
    organizationName: booking?.organization?.name,
    facilityName: booking?.subSpace.facility.name ?? "",
    subSpaceName: booking?.subSpace.name ?? "",
    startAt: booking ? formatDateTime(booking.startAt) : "",
    endAt: booking ? formatDateTime(booking.endAt) : "",
    activityType: booking?.activityType ?? "",
    feeFormatted: formatMoney(invoiceTotal),
    bookingReference: booking?.reference ?? "Annual agreement",
    insuranceRequirement: INSURANCE_REQUIREMENT_TEXT,
  };

  const sent = await provider.send({
    documentType: document.type,
    documentId: document.id,
    signer: {
      name: document.signerName ?? document.user?.name ?? "",
      email: document.signerEmail ?? document.user?.email ?? "",
    },
    fields,
    returnUrl: `${env.appUrl}/portal`,
  });

  const publicToken = sent.signingUrl?.split("/").pop() ?? randomToken(24);

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: {
      status: DocumentStatus.SENT,
      provider: sent.provider,
      envelopeId: sent.envelopeId,
      publicToken,
    },
  });

  await recordAudit({
    entityType: "document",
    entityId: document.id,
    action: "document.sent",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    toState: DocumentStatus.SENT,
    payload: { provider: sent.provider, envelopeId: sent.envelopeId, type: document.type },
  });

  return updated;
}

/**
 * Record a signature. Called by the provider webhook, or by the in-app signing
 * page when ESIGN_PROVIDER is "manual".
 */
export async function recordSignature(
  documentId: string,
  signer: { name: string; email: string; ipAddress?: string | null },
  signedAt: Date = new Date(),
): Promise<Document> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new NotFoundError("Document");
  if (document.status === DocumentStatus.SIGNED) return document;

  const expiresAt =
    document.type === DocumentType.ANNUAL_COACH_AGREEMENT
      ? agreementExpiryFor(signedAt)
      : document.expiresAt;

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      status: DocumentStatus.SIGNED,
      signedAt,
      signerName: signer.name,
      signerEmail: signer.email,
      expiresAt,
    },
  });

  await recordAudit({
    entityType: "document",
    entityId: documentId,
    action: "document.signed",
    actorId: document.userId,
    actorLabel: signer.name,
    fromState: document.status,
    toState: DocumentStatus.SIGNED,
    ipAddress: signer.ipAddress ?? null,
    payload: {
      type: document.type,
      signerEmail: signer.email,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  });

  // Pull down the executed PDF and store it immutably.
  if (document.envelopeId && document.provider !== "manual") {
    try {
      const pdf = await esignProvider().fetchDocument(document.envelopeId);
      if (pdf) {
        const key = documentKey(documentId, `${document.type.toLowerCase()}.pdf`, signedAt);
        await storage().put(key, pdf, "application/pdf");
        await prisma.document.update({ where: { id: documentId }, data: { fileUrl: key } });
      }
    } catch (error) {
      // A failed PDF fetch must not block the booking; the signature is
      // recorded and an admin can re-fetch.
      await recordAudit({
        entityType: "document",
        entityId: documentId,
        action: "document.pdf_fetch_failed",
        actorLabel: "system",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (document.bookingId) {
    const { advanceBooking } = await import("./booking-service");
    await advanceBooking(document.bookingId, {
      id: "system",
      name: "system",
      role: "SUPER_ADMIN",
    });
  }

  return updated;
}

/** Attach an uploaded certificate of insurance and record its expiry. */
export async function uploadCertificateOfInsurance(params: {
  documentId?: string;
  bookingId?: string;
  organizationId?: string;
  file: Uint8Array;
  filename: string;
  contentType: string;
  expiresAt: Date;
  actor: Actor;
}): Promise<Document> {
  const { file, filename, contentType, expiresAt, actor } = params;

  if (expiresAt <= new Date()) {
    throw new ValidationError("That certificate is already expired.");
  }

  const document = params.documentId
    ? await prisma.document.findUnique({ where: { id: params.documentId } })
    : await prisma.document.findFirst({
        where: { bookingId: params.bookingId, type: DocumentType.CERTIFICATE_OF_INSURANCE },
      });

  const target =
    document ??
    (await prisma.document.create({
      data: {
        bookingId: params.bookingId ?? null,
        organizationId: params.organizationId ?? null,
        type: DocumentType.CERTIFICATE_OF_INSURANCE,
        status: DocumentStatus.NOT_STARTED,
        provider: "upload",
      },
    }));

  const key = documentKey(target.id, filename);
  await storage().put(key, file, contentType);

  const updated = await prisma.document.update({
    where: { id: target.id },
    data: {
      status: DocumentStatus.UPLOADED,
      fileUrl: key,
      expiresAt,
      metadata: { filename, contentType, sizeBytes: file.byteLength } as Prisma.InputJsonValue,
    },
  });

  if (target.organizationId) {
    // Denormalised onto the organisation so the expiry sweep is a single query.
    await prisma.organization.update({
      where: { id: target.organizationId },
      data: { coiDocumentId: target.id, coiExpiresAt: expiresAt },
    });
  }

  await recordAudit({
    entityType: "document",
    entityId: target.id,
    action: "document.coi_uploaded",
    actorId: actor.id === "system" ? null : actor.id,
    actorLabel: actor.name,
    toState: DocumentStatus.UPLOADED,
    payload: { expiresAt: expiresAt.toISOString(), filename },
  });

  if (target.bookingId) {
    const { advanceBooking } = await import("./booking-service");
    await advanceBooking(target.bookingId, actor);
  }

  return updated;
}

/** Issue this year's Annual Coach Agreement to a staff member. */
export async function issueAnnualAgreement(userId: string, actor: Actor): Promise<Document> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User");

  const existing = await prisma.document.findFirst({
    where: {
      userId,
      type: DocumentType.ANNUAL_COACH_AGREEMENT,
      status: { in: [DocumentStatus.SENT, DocumentStatus.VIEWED, DocumentStatus.SIGNED] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (existing) return existing;

  const document = await prisma.document.create({
    data: {
      userId,
      type: DocumentType.ANNUAL_COACH_AGREEMENT,
      status: DocumentStatus.NOT_STARTED,
      signerName: user.name,
      signerEmail: user.email,
      provider: env.esign.provider,
      expiresAt: agreementExpiryFor(),
    },
  });

  return sendDocument(document.id, actor);
}

/** Certificates expiring inside the warning window. Drives the admin alert. */
export async function expiringCertificates(withinDays: number, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() + withinDays * 86_400_000);
  return prisma.document.findMany({
    where: {
      type: DocumentType.CERTIFICATE_OF_INSURANCE,
      status: { in: [DocumentStatus.UPLOADED, DocumentStatus.SIGNED] },
      expiresAt: { not: null, lte: cutoff, gte: now },
    },
    include: { booking: { include: { requester: true, organization: true } } },
    orderBy: { expiresAt: "asc" },
  });
}

/** Staff without a current signed agreement. Drives the weekly AD digest. */
export async function staffMissingAgreements(now: Date = new Date()) {
  const { AGREEMENT_REQUIRED_ROLES } = await import("@/domain/compliance");
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: [...AGREEMENT_REQUIRED_ROLES] } },
    include: { documents: { where: { type: DocumentType.ANNUAL_COACH_AGREEMENT } } },
  });

  return users.filter((u) => {
    const current = u.documents.find(
      (d) => d.status === DocumentStatus.SIGNED && (d.expiresAt === null || d.expiresAt > now),
    );
    return !current;
  });
}

export const INSURANCE_REQUIREMENT_TEXT =
  "Commercial general liability naming Orchard Lake St. Mary's Preparatory as an " +
  "additional insured. Limits to be confirmed with the school's carrier and counsel " +
  "before launch (see DECISIONS.md).";

export { DOCUMENT_LABELS };
