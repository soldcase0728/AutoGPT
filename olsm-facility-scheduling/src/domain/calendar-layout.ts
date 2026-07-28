/**
 * Calendar geometry.
 *
 * Kept out of the React component so the fiddly part -- deciding how
 * overlapping bookings share horizontal space -- is testable without a browser.
 *
 * Positions are percentages, so the component can be sized entirely in CSS and
 * still line up with the hour gutter.
 */

export interface LaidOutEvent<T> {
  event: T;
  /** Percent from the top of the column. */
  top: number;
  /** Percent of the column height. */
  height: number;
  /** Percent from the left of the column. */
  left: number;
  /** Percent of the column width. */
  width: number;
  /** Which overlap lane this landed in; used only for z-order and testing. */
  lane: number;
}

export interface TimeSpan {
  startMinutes: number;
  endMinutes: number;
}

/** Minimum rendered height so a 15-minute booking is still clickable. */
const MIN_HEIGHT_PERCENT = 1.5;

/**
 * Lay out a column of events.
 *
 * Events that overlap in time are placed in side-by-side lanes. Lanes are
 * assigned greedily against the *cluster* of mutually overlapping events, not
 * pairwise: three bookings that all overlap get a third of the width each, and
 * a fourth booking that only overlaps one of them does not force everything
 * narrower.
 */
export function layoutColumn<T extends TimeSpan>(
  events: readonly T[],
  dayStartMinutes: number,
  dayEndMinutes: number,
): LaidOutEvent<T>[] {
  const span = dayEndMinutes - dayStartMinutes;
  if (span <= 0 || events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes,
  );

  // Group into clusters of transitively overlapping events.
  const clusters: T[][] = [];
  let current: T[] = [];
  let clusterEnd = -Infinity;

  for (const event of sorted) {
    if (current.length > 0 && event.startMinutes >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(event);
    clusterEnd = Math.max(clusterEnd, event.endMinutes);
  }
  if (current.length > 0) clusters.push(current);

  const out: LaidOutEvent<T>[] = [];

  for (const cluster of clusters) {
    // Greedy lane packing: reuse the first lane whose last event has ended.
    const laneEnds: number[] = [];
    const laneOf = new Map<T, number>();

    for (const event of cluster) {
      let lane = laneEnds.findIndex((end) => end <= event.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(event.endMinutes);
      } else {
        laneEnds[lane] = event.endMinutes;
      }
      laneOf.set(event, lane);
    }

    const lanes = laneEnds.length;

    for (const event of cluster) {
      const lane = laneOf.get(event)!;
      const clampedStart = Math.max(event.startMinutes, dayStartMinutes);
      const clampedEnd = Math.min(event.endMinutes, dayEndMinutes);

      out.push({
        event,
        top: ((clampedStart - dayStartMinutes) / span) * 100,
        height: Math.max(((clampedEnd - clampedStart) / span) * 100, MIN_HEIGHT_PERCENT),
        left: (lane / lanes) * 100,
        width: 100 / lanes,
        lane,
      });
    }
  }

  return out;
}

/** Minutes since local midnight. */
export function minutesOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

/** Snap a minute offset to the nearest step, for drag-to-create. */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}

export function formatMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The hour range a grid should render. Driven by the data rather than a fixed
 * 00:00-24:00, so a day of 3:30pm practices is not 60% empty -- but always wide
 * enough to show the facility's published hours.
 */
export function gridBounds(
  spans: readonly TimeSpan[],
  openMinutes: number,
  closeMinutes: number,
): { startMinutes: number; endMinutes: number } {
  let start = openMinutes;
  let end = closeMinutes;

  for (const span of spans) {
    start = Math.min(start, span.startMinutes);
    end = Math.max(end, span.endMinutes);
  }

  // Whole hours, with a little air.
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60);

  if (end - start < 240) end = Math.min(24 * 60, start + 240);
  return { startMinutes: start, endMinutes: end };
}
