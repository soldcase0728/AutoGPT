/**
 * Release status for the People page. Mirrors `consent_state()` in
 * 0003_consent_gate.sql so the page and the publication gate agree.
 */

export type ReleaseStatus = "valid" | "missing" | "revoked" | "expired" | "outdated";

export interface ConsentRecord {
  type: "media_release" | "parental" | "nil";
  document_version: string;
  signed_at: string;
  signed_by: string;
  expires_at: string | null;
  revoked_at: string | null;
}

function live(record: ConsentRecord, now: Date) {
  return !record.revoked_at && (!record.expires_at || new Date(record.expires_at) > now);
}

/** The record the gate would look at: live ones first, then the most recent. */
export function currentRecord(
  records: ConsentRecord[],
  type: ConsentRecord["type"],
  now = new Date(),
): ConsentRecord | null {
  const ofType = records.filter((r) => r.type === type);
  ofType.sort(
    (a, b) =>
      Number(!b.revoked_at) - Number(!a.revoked_at) ||
      Number(!b.expires_at || new Date(b.expires_at) > now) -
        Number(!a.expires_at || new Date(a.expires_at) > now) ||
      b.signed_at.localeCompare(a.signed_at),
  );
  return ofType[0] ?? null;
}

export function releaseStatus(
  records: ConsentRecord[],
  type: ConsentRecord["type"],
  options: { now?: Date; requiredVersion?: string } = {},
): ReleaseStatus {
  const now = options.now ?? new Date();
  const record = currentRecord(records, type, now);
  if (!record) return "missing";
  if (record.revoked_at) return "revoked";
  if (record.expires_at && new Date(record.expires_at) <= now) return "expired";
  if (
    options.requiredVersion &&
    !records.some(
      (r) => r.type === type && r.document_version === options.requiredVersion && live(r, now),
    )
  ) {
    return "outdated";
  }
  return "valid";
}

/** Under 18, or no birth year on file: the gate needs a parental release. */
export function needsParentalRelease(birthYear: number | null, now = new Date()): boolean {
  return birthYear === null || now.getFullYear() - birthYear < 18;
}

export const RELEASE_LABEL: Record<ReleaseStatus, string> = {
  valid: "On file",
  missing: "Not signed",
  revoked: "Withdrawn",
  expired: "Expired",
  outdated: "Old wording, must re-sign",
};

/**
 * A temporary password an admin can read out or text: no look-alike
 * characters, grouped for reading, 60+ bits of entropy.
 */
export function temporaryPassword(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY34679";
  const bytes = random(15);
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}
