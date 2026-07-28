/**
 * Sub-space conflict graph.
 *
 * A sub-space declares, in `blocksIds`, the other sub-spaces it physically
 * occupies. "Full floor" at Dombrowski lists Court A and Court B. Court A lists
 * nothing, so Court A and Court B can be booked simultaneously.
 *
 * Two properties matter and neither is automatic:
 *
 *  1. Containment is transitive. If "Whole facility" blocks "Full floor" and
 *     "Full floor" blocks "Court A", booking the whole facility must block
 *     Court A. `occupiedSubSpaceIds` walks the graph to a fixed point.
 *
 *  2. Blocking is symmetric in effect but not in declaration. "Full floor"
 *     declares that it blocks Court A; Court A says nothing. Booking Court A
 *     must still prevent a Full-floor booking. That falls out for free because
 *     the Full-floor booking expands to include Court A, and the exclusion
 *     constraint sees the collision on the Court A row.
 *
 * Adjacency between facilities (stadium field also closes the running track) is
 * the same mechanism: an admin adds the track sub-space to the stadium field's
 * blocksIds. Nothing here is aware of facility boundaries.
 */

export interface SubSpaceNode {
  id: string;
  name: string;
  facilityId: string;
  blocksIds: string[];
  bufferMinutes?: number | null;
}

export type SubSpaceIndex = ReadonlyMap<string, SubSpaceNode>;

export function indexSubSpaces(nodes: readonly SubSpaceNode[]): SubSpaceIndex {
  return new Map(nodes.map((n) => [n.id, n]));
}

/**
 * Every sub-space a booking of `subSpaceId` occupies, including itself.
 * Cycles in the graph are tolerated — the visited set terminates the walk —
 * because an admin can legitimately declare a mutual block (two overlapping
 * halves of a field that each consume the other).
 */
export function occupiedSubSpaceIds(subSpaceId: string, index: SubSpaceIndex): string[] {
  const seen = new Set<string>();
  const stack = [subSpaceId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = index.get(current);
    if (!node) continue;
    for (const child of node.blocksIds) {
      if (!seen.has(child)) stack.push(child);
    }
  }

  return [...seen];
}

/**
 * True when booking `a` and booking `b` cannot coexist because their occupied
 * sets intersect. Used for pre-flight warnings in the UI and for the season
 * allocation collision screen; the database constraint is the real enforcement.
 */
export function subSpacesConflict(a: string, b: string, index: SubSpaceIndex): boolean {
  if (a === b) return true;
  const setA = new Set(occupiedSubSpaceIds(a, index));
  return occupiedSubSpaceIds(b, index).some((id) => setA.has(id));
}

/** Buffer minutes for a sub-space, falling back to the facility default. */
export function bufferMinutesFor(
  node: SubSpaceNode | undefined,
  facilityBuffer: number,
): number {
  if (!node) return facilityBuffer;
  return node.bufferMinutes ?? facilityBuffer;
}

/**
 * Setup/teardown padding applied to a booking before it is written to
 * booking_occupancy. The buffer is the maximum across every occupied
 * sub-space: booking the full floor of a room whose batting cage needs 20
 * minutes of turnover inherits the 20 minutes.
 */
export function paddedWindow(
  start: Date,
  end: Date,
  occupiedIds: readonly string[],
  index: SubSpaceIndex,
  facilityBufferById: ReadonlyMap<string, number>,
): { start: Date; end: Date; bufferMinutes: number } {
  let buffer = 0;
  for (const id of occupiedIds) {
    const node = index.get(id);
    const facilityBuffer = node ? (facilityBufferById.get(node.facilityId) ?? 0) : 0;
    buffer = Math.max(buffer, bufferMinutesFor(node, facilityBuffer));
  }
  return {
    start: new Date(start.getTime() - buffer * 60_000),
    end: new Date(end.getTime() + buffer * 60_000),
    bufferMinutes: buffer,
  };
}
