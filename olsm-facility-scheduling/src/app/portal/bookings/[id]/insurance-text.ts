/**
 * Kept in a client-importable module so the upload form can show the
 * requirement without pulling the whole document service (and its server-only
 * dependencies) into the browser bundle.
 *
 * Limits and additional-insured language are an open decision -- see
 * DECISIONS.md. Confirm with OLSM's carrier and counsel before launch.
 */
export const INSURANCE_REQUIREMENT_TEXT =
  "Commercial general liability naming Orchard Lake St. Mary's Preparatory as an additional " +
  "insured. Specific limits are pending confirmation with the school's insurance carrier.";
