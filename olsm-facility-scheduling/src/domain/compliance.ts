/**
 * Liability gates.
 *
 * Two independent checks:
 *
 *  1. The Annual Coach Agreement. Every internal staff member signs one per
 *     school year. No signed, unexpired agreement means the account cannot
 *     create any booking at all -- this is the enforcement mechanism that makes
 *     liability capture cost a head coach nothing after August. Acceptance
 *     criterion 3.
 *
 *  2. Per-booking documents: contract, waiver, certificate of insurance. A
 *     missing or expired COI blocks CONFIRMED. Acceptance criterion 8.
 */

import { DocumentStatus, DocumentType, Role } from "@prisma/client";

/** Roles that must hold a signed Annual Coach Agreement before booking. */
export const AGREEMENT_REQUIRED_ROLES: readonly Role[] = [
  Role.HEAD_COACH,
  Role.ASSISTANT_COACH,
  Role.TRAINER,
  Role.STRENGTH_COACH,
];

/** Days before a COI expires that admins start getting warned. */
export const COI_WARNING_DAYS = 30;

export interface AgreementLike {
  type: DocumentType;
  status: DocumentStatus;
  expiresAt: Date | null;
  signedAt: Date | null;
}

export interface AgreementCheck {
  ok: boolean;
  reason?: "MISSING" | "UNSIGNED" | "EXPIRED";
  message?: string;
  expiresAt?: Date | null;
}

export function checkAnnualAgreement(
  role: Role,
  documents: readonly AgreementLike[],
  now: Date = new Date(),
): AgreementCheck {
  if (!AGREEMENT_REQUIRED_ROLES.includes(role)) return { ok: true };

  const agreements = documents.filter(
    (d) => d.type === DocumentType.ANNUAL_COACH_AGREEMENT,
  );

  if (agreements.length === 0) {
    return {
      ok: false,
      reason: "MISSING",
      message:
        "Your Annual Coach Agreement is not on file. It covers facility use rules, " +
        "supervision, emergency and concussion protocol, and outside paid instruction. " +
        "Sign it once and you can book for the rest of the school year.",
    };
  }

  const signed = agreements.filter((d) => d.status === DocumentStatus.SIGNED);
  if (signed.length === 0) {
    return {
      ok: false,
      reason: "UNSIGNED",
      message: "Your Annual Coach Agreement has been sent but is not signed yet.",
    };
  }

  const current = signed.find((d) => d.expiresAt === null || d.expiresAt > now);
  if (!current) {
    const latest = signed
      .slice()
      .sort((a, b) => (b.expiresAt?.getTime() ?? 0) - (a.expiresAt?.getTime() ?? 0))[0];
    return {
      ok: false,
      reason: "EXPIRED",
      message:
        "Your Annual Coach Agreement expired for this school year. Sign the new one to book again.",
      expiresAt: latest.expiresAt,
    };
  }

  return { ok: true, expiresAt: current.expiresAt };
}

export interface CoiLike {
  status: DocumentStatus;
  expiresAt: Date | null;
}

export interface CoiCheck {
  ok: boolean;
  reason?: "MISSING" | "UNAPPROVED" | "EXPIRED" | "EXPIRES_BEFORE_EVENT";
  message?: string;
  expiresAt?: Date | null;
}

/**
 * A COI must be valid on the day of the event, not merely today. A certificate
 * expiring next week does not cover a rental next month.
 */
export function checkCertificateOfInsurance(
  cois: readonly CoiLike[],
  eventEndAt: Date,
  now: Date = new Date(),
): CoiCheck {
  if (cois.length === 0) {
    return {
      ok: false,
      reason: "MISSING",
      message: "A current certificate of insurance is required before this booking can confirm.",
    };
  }

  const accepted = cois.filter(
    (c) => c.status === DocumentStatus.UPLOADED || c.status === DocumentStatus.SIGNED,
  );
  if (accepted.length === 0) {
    return {
      ok: false,
      reason: "UNAPPROVED",
      message: "The certificate of insurance on file has not been accepted by the athletic office.",
    };
  }

  const validNow = accepted.filter((c) => c.expiresAt === null || c.expiresAt > now);
  if (validNow.length === 0) {
    return {
      ok: false,
      reason: "EXPIRED",
      message: "The certificate of insurance on file has expired.",
      expiresAt: accepted[0].expiresAt,
    };
  }

  const coversEvent = validNow.find((c) => c.expiresAt === null || c.expiresAt >= eventEndAt);
  if (!coversEvent) {
    return {
      ok: false,
      reason: "EXPIRES_BEFORE_EVENT",
      message:
        "The certificate of insurance on file expires before this booking takes place. " +
        "Upload a certificate that covers the event date.",
      expiresAt: validNow[0].expiresAt,
    };
  }

  return { ok: true, expiresAt: coversEvent.expiresAt };
}

export interface DocumentGateResult {
  cleared: boolean;
  outstanding: { type: DocumentType; label: string; reason: string }[];
}

/**
 * Whether every per-booking document gate is satisfied. Contracts and waivers
 * must be SIGNED; a COI must be accepted and cover the event date.
 */
export function checkBookingDocuments(
  required: readonly DocumentType[],
  documents: readonly (AgreementLike & { type: DocumentType })[],
  eventEndAt: Date,
  now: Date = new Date(),
): DocumentGateResult {
  const outstanding: DocumentGateResult["outstanding"] = [];

  for (const type of required) {
    const matching = documents.filter((d) => d.type === type);

    if (type === DocumentType.CERTIFICATE_OF_INSURANCE) {
      const check = checkCertificateOfInsurance(matching, eventEndAt, now);
      if (!check.ok) {
        outstanding.push({
          type,
          label: DOCUMENT_LABELS[type],
          reason: check.message ?? "Outstanding.",
        });
      }
      continue;
    }

    const signed = matching.find((d) => d.status === DocumentStatus.SIGNED);
    if (!signed) {
      const sent = matching.find((d) => d.status === DocumentStatus.SENT);
      outstanding.push({
        type,
        label: DOCUMENT_LABELS[type],
        reason: sent ? "Sent, awaiting signature." : "Not sent yet.",
      });
    }
  }

  return { cleared: outstanding.length === 0, outstanding };
}

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  ANNUAL_COACH_AGREEMENT: "Annual Coach Agreement",
  FACILITY_USE_AGREEMENT: "Facility Use Agreement",
  LIABILITY_WAIVER: "Liability Waiver & Release",
  CAMP_ADDENDUM: "Camp / Clinic Addendum",
  MINOR_PARTICIPANT_WAIVER: "Minor Participant Waiver",
  CERTIFICATE_OF_INSURANCE: "Certificate of Insurance",
};

/**
 * The school year an agreement signed on `at` covers. OLSM's year rolls on
 * 1 August, so an agreement signed in June belongs to the year that is ending
 * and expires that 31 July.
 */
export function agreementExpiryFor(at: Date = new Date()): Date {
  const year = at.getUTCFullYear();
  const augustFirst = Date.UTC(year, 7, 1);
  const endYear = at.getTime() >= augustFirst ? year + 1 : year;
  // 31 July of the following school year, end of day UTC.
  return new Date(Date.UTC(endYear, 6, 31, 23, 59, 59));
}
