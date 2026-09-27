/**
 * How the app addresses someone by name. Pure, so it is unit-tested.
 */

/**
 * The first name from a roster name ("Ali Haddad" → "Ali"), or null when there
 * isn't a usable one: empty, a lone initial ("C. Castiglione"), or an email.
 */
export function firstName(displayName: string | null | undefined): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (first.length < 2 || first.endsWith(".") || first.includes("@")) return null;
  return first;
}

/** "Ali's shots", "James' shots", or "Your shots" without a usable name. */
export function shotsHeading(displayName: string | null | undefined): string {
  const name = firstName(displayName);
  if (!name) return "Your shots";
  return `${name}${/s$/i.test(name) ? "'" : "'s"} shots`;
}
