export interface WeightedIdea {
  id: string;
  weight: number;
}

/**
 * Picks the next prompt for one student.
 *
 * Ideas the student shot recently are held back so the same person is not asked
 * the same thing twice in a fortnight — and so marketing gets variety rather
 * than twenty versions of one shot. If everything is recent, the whole bank
 * comes back into play rather than assigning nothing.
 */
export function pickIdea(
  ideas: WeightedIdea[],
  recentIdeaIds: string[],
  random: () => number = Math.random,
): string | null {
  if (ideas.length === 0) return null;

  const recent = new Set(recentIdeaIds);
  const fresh = ideas.filter((i) => !recent.has(i.id));
  const pool = fresh.length > 0 ? fresh : ideas;

  const total = pool.reduce((sum, i) => sum + Math.max(1, i.weight), 0);
  let ticket = random() * total;

  for (const idea of pool) {
    ticket -= Math.max(1, idea.weight);
    if (ticket <= 0) return idea.id;
  }
  return pool[pool.length - 1]?.id ?? null;
}

/** How many days back to treat an idea as "recently shot" for one student. */
export const RECENT_WINDOW_DAYS = 14;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDate(d);
}
