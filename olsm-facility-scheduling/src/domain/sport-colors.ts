/**
 * Sport colours for the calendar.
 *
 * A week of team practice used to be one flat navy, so telling basketball from
 * wrestling meant reading every block. Colour carries that now.
 *
 * Six hues, not eleven. Eleven mutually distinguishable colours do not exist at
 * this size: validated against all pairs, eight already fail — red against
 * orange sits at ΔE 7.1 for readers with ordinary colour vision, well under the
 * 15 floor. Six pass every check with room to spare. The school runs at most
 * four sports in any one season, so six slots are enough for every sport in
 * view to differ; two sports only share a hue when their seasons do not
 * overlap.
 *
 * Colour is never the only signal. Every block carries its own title and
 * subtitle, and the legend names each sport beside its swatch -- which is also
 * what makes the one soft spot acceptable: aqua against magenta separates at
 * ΔE 6.1 for deuteranopia, inside the band that is permissible only when
 * something other than hue identifies the mark.
 *
 * Each ink was chosen to clear WCAG AA against its own fill at the 11px the
 * grid uses. The blue is a step lighter than the reference palette's for that
 * reason: the original sat at 4.46:1, just under, and darkening it instead
 * collided with violet.
 */

import type { Sport } from "@prisma/client";

export interface SportColor {
  /** Block fill and legend swatch. */
  fill: string;
  /** Text on that fill. AA at 11px. */
  ink: string;
  name: string;
}

/** Fixed order. Never cycled, never generated. */
export const SPORT_PALETTE: readonly SportColor[] = [
  { name: "blue", fill: "#3d85dc", ink: "#0b0b0b" },
  { name: "aqua", fill: "#1baf7a", ink: "#0b0b0b" },
  { name: "yellow", fill: "#eda100", ink: "#0b0b0b" },
  { name: "magenta", fill: "#e87ba4", ink: "#0b0b0b" },
  { name: "green", fill: "#008300", ink: "#ffffff" },
  { name: "violet", fill: "#4a3aa7", ink: "#ffffff" },
];

/**
 * Anything with no sport: rentals, school events, camps, maintenance.
 *
 * Deliberately outside the categorical palette and deliberately unsaturated --
 * it is a category, not a team, and it must not read as a twelfth sport.
 */
export const NON_TEAM_COLOR: SportColor = {
  name: "slate",
  fill: "#5b6472",
  ink: "#ffffff",
};

/**
 * Which slot a sport uses.
 *
 * `colorSlot` on the sport wins when set -- the seed assigns them so that no
 * two sports sharing a season share a hue. A sport added later has none, so it
 * falls back to a hash of its name: stable across restarts and across machines,
 * which matters because a colour that moves is worse than a colour somebody
 * dislikes.
 */
export function slotForSport(sport: Pick<Sport, "name" | "colorSlot">): number {
  if (sport.colorSlot != null) {
    // Stored 1-based so the seed reads like the palette table.
    const index = sport.colorSlot - 1;
    if (index >= 0 && index < SPORT_PALETTE.length) return index;
  }

  let hash = 0;
  for (const char of sport.name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  }
  return hash % SPORT_PALETTE.length;
}

export function colorForSport(sport: Pick<Sport, "name" | "colorSlot"> | null): SportColor {
  if (!sport) return NON_TEAM_COLOR;
  return SPORT_PALETTE[slotForSport(sport)];
}

export interface LegendEntry {
  key: string;
  label: string;
  color: SportColor;
}

/**
 * What to show beside the calendar.
 *
 * Only what is actually on screen. A legend listing eleven sports when three
 * are visible is a lookup table nobody reads; one listing exactly the three is
 * a key.
 */
export function legendFor(
  bookings: readonly { sport: Pick<Sport, "id" | "name" | "colorSlot"> | null }[],
): LegendEntry[] {
  const sports = new Map<string, LegendEntry>();
  let anyNonTeam = false;

  for (const booking of bookings) {
    if (!booking.sport) {
      anyNonTeam = true;
      continue;
    }
    if (sports.has(booking.sport.id)) continue;
    sports.set(booking.sport.id, {
      key: booking.sport.id,
      label: booking.sport.name,
      color: colorForSport(booking.sport),
    });
  }

  const entries = [...sports.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (anyNonTeam) {
    entries.push({ key: "non-team", label: "Rentals, events, maintenance", color: NON_TEAM_COLOR });
  }
  return entries;
}
