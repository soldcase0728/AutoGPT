import type { ConsentBlocker } from "./types";

/**
 * Blocker reasons come out of `capture_consent_blockers()` as stable slugs.
 * They are rendered for a marketing reviewer, so each one says what is wrong
 * and who has to do something about it.
 */
const REASONS: Record<string, string> = {
  no_people_declared:
    "Nobody is tagged and the student did not confirm the shot is unidentifiable.",
  capture_not_found: "This capture no longer exists.",
  age_unknown: "Birth year is missing, so we cannot tell if a parental release is needed.",
  media_release_missing: "Has not signed a media release.",
  media_release_revoked: "Withdrew their media release.",
  media_release_expired: "Media release has expired.",
  parental_missing: "Under 18 — no parental release on file.",
  parental_revoked: "Under 18 — the parental release was withdrawn.",
  parental_expired: "Under 18 — the parental release has expired.",
  nil_missing: "No NIL agreement on file.",
  nil_revoked: "NIL agreement was withdrawn.",
  nil_expired: "NIL agreement has expired.",
};

export function describeBlocker(blocker: ConsentBlocker): string {
  const base = REASONS[blocker.reason] ?? `Unresolved: ${blocker.reason}`;
  if (blocker.detail) return blocker.detail;
  return blocker.person ? `${blocker.person} — ${base}` : base;
}

export function publishable(blockers: ConsentBlocker[] | null | undefined): boolean {
  return (blockers?.length ?? 0) === 0;
}

/** A name reduced for comparison: case, spacing and punctuation don't count. */
function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether a typed signature is the roster name. "  ali   HADDAD " and
 * "C Castiglione" match "Ali Haddad" and "C. Castiglione".
 */
export function signatureMatches(typed: string, rosterName: string): boolean {
  const want = normaliseName(rosterName);
  return want.length > 0 && normaliseName(typed) === want;
}
