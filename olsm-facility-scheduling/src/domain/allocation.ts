/**
 * Season allocation collision detection.
 *
 * Before a season's standing blocks are published, every generated occurrence
 * is checked against (a) every other generated occurrence and (b) bookings
 * already on the calendar. Nothing publishes while an unresolved collision
 * remains -- that is acceptance criterion 6.
 *
 * Collisions are detected through the conflict graph, so "Boys Basketball on
 * Rakoczy Full Court" collides with "Volleyball on Rakoczy Court 1" even though
 * the two sub-space ids differ.
 */

import { occupiedSubSpaceIds, type SubSpaceIndex } from "./conflict-graph";
import { overlaps } from "@/lib/time";

export interface AllocationOccurrence {
  blockId: string;
  blockLabel: string;
  sportName: string;
  teamLevel: string;
  subSpaceId: string;
  subSpaceName: string;
  priority: number;
  date: string;
  startAt: Date;
  endAt: Date;
}

export interface ExistingReservation {
  bookingId: string;
  reference: string;
  title: string;
  subSpaceId: string;
  subSpaceName: string;
  priority: number;
  startAt: Date;
  endAt: Date;
}

export type CollisionKind = "block-vs-block" | "block-vs-booking";

export interface Collision {
  kind: CollisionKind;
  date: string;
  left: AllocationOccurrence;
  right: AllocationOccurrence | ExistingReservation;
  /** The sub-spaces both sides occupy. Useful for explaining the collision. */
  sharedSubSpaceIds: string[];
  /** Which side the priority ranking favours. */
  suggested: "left" | "right" | "tie";
}

export interface CollisionReport {
  collisions: Collision[];
  occurrenceCount: number;
  /** Blocks with at least one collision; the ones the UI must surface. */
  affectedBlockIds: string[];
  publishable: boolean;
}

function sharedSpaces(a: string, b: string, index: SubSpaceIndex): string[] {
  const setA = new Set(occupiedSubSpaceIds(a, index));
  return occupiedSubSpaceIds(b, index).filter((id) => setA.has(id));
}

function suggest(leftPriority: number, rightPriority: number): "left" | "right" | "tie" {
  if (leftPriority < rightPriority) return "left";
  if (rightPriority < leftPriority) return "right";
  return "tie";
}

export function detectCollisions(
  occurrences: readonly AllocationOccurrence[],
  existing: readonly ExistingReservation[],
  index: SubSpaceIndex,
): CollisionReport {
  const collisions: Collision[] = [];

  // Bucket by local date so the pairwise scan stays cheap on a full season
  // (a winter season across every indoor space is ~4,000 occurrences; bucketed
  // this is a few hundred comparisons per day rather than 16 million).
  const byDate = new Map<string, AllocationOccurrence[]>();
  for (const occ of occurrences) {
    const list = byDate.get(occ.date);
    if (list) list.push(occ);
    else byDate.set(occ.date, [occ]);
  }

  for (const [date, sameDay] of byDate) {
    for (let i = 0; i < sameDay.length; i++) {
      for (let j = i + 1; j < sameDay.length; j++) {
        const a = sameDay[i];
        const b = sameDay[j];
        if (!overlaps(a.startAt, a.endAt, b.startAt, b.endAt)) continue;
        const shared = sharedSpaces(a.subSpaceId, b.subSpaceId, index);
        if (shared.length === 0) continue;
        collisions.push({
          kind: "block-vs-block",
          date,
          left: a,
          right: b,
          sharedSubSpaceIds: shared,
          suggested: suggest(a.priority, b.priority),
        });
      }
    }
  }

  for (const occ of occurrences) {
    for (const res of existing) {
      if (!overlaps(occ.startAt, occ.endAt, res.startAt, res.endAt)) continue;
      const shared = sharedSpaces(occ.subSpaceId, res.subSpaceId, index);
      if (shared.length === 0) continue;
      collisions.push({
        kind: "block-vs-booking",
        date: occ.date,
        left: occ,
        right: res,
        sharedSubSpaceIds: shared,
        suggested: suggest(occ.priority, res.priority),
      });
    }
  }

  const affected = new Set<string>();
  for (const c of collisions) {
    affected.add(c.left.blockId);
    if ("blockId" in c.right) affected.add(c.right.blockId);
  }

  return {
    collisions,
    occurrenceCount: occurrences.length,
    affectedBlockIds: [...affected],
    publishable: collisions.length === 0,
  };
}

/**
 * Open inventory: the gaps left in a facility's operating hours once standing
 * blocks and existing bookings are laid down. Drives the "remaining time is
 * visible as open inventory" requirement.
 */
export interface Interval {
  start: Date;
  end: Date;
}

export function freeIntervals(
  openWindow: Interval,
  busy: readonly Interval[],
  minimumMinutes = 30,
): Interval[] {
  const sorted = [...busy]
    .filter((b) => b.end > openWindow.start && b.start < openWindow.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const free: Interval[] = [];
  let cursor = openWindow.start;

  for (const b of sorted) {
    if (b.start > cursor) {
      const gapMinutes = (b.start.getTime() - cursor.getTime()) / 60_000;
      if (gapMinutes >= minimumMinutes) free.push({ start: cursor, end: b.start });
    }
    if (b.end > cursor) cursor = b.end;
  }

  if (cursor < openWindow.end) {
    const gapMinutes = (openWindow.end.getTime() - cursor.getTime()) / 60_000;
    if (gapMinutes >= minimumMinutes) free.push({ start: cursor, end: openWindow.end });
  }

  return free;
}
