/**
 * Review queue structure: which states each tab holds, how a search is made
 * safe for a PostgREST filter, and where the reviewer lands after a decision.
 * Pure, so it is unit-tested.
 */

import type { CaptureState } from "./types";

export type QueueTabId = "review" | "waiting" | "ready" | "posted" | "rejected";

export interface QueueTab {
  id: QueueTabId;
  label: string;
  states: CaptureState[];
  /** Work queues run oldest first; history runs newest first. */
  newestFirst: boolean;
  empty: string;
}

export const QUEUE_TABS: QueueTab[] = [
  {
    id: "review",
    label: "To review",
    states: ["submitted", "in_review"],
    newestFirst: false,
    empty: "Nothing new to review.",
  },
  {
    id: "waiting",
    label: "Waiting on student",
    states: ["changes_requested"],
    newestFirst: false,
    empty: "No reshoots outstanding.",
  },
  {
    id: "ready",
    label: "Ready to post",
    states: ["approved"],
    newestFirst: false,
    empty: "Nothing approved and waiting to go out.",
  },
  {
    id: "posted",
    label: "Posted",
    states: ["published"],
    newestFirst: true,
    empty: "Nothing posted yet.",
  },
  {
    id: "rejected",
    label: "Rejected",
    states: ["rejected"],
    newestFirst: true,
    empty: "Nothing rejected.",
  },
];

/** The tab for a URL, accepting the older `?state=` links too. */
export function resolveTab(tab?: string | null, legacyState?: string | null): QueueTab {
  const byId = QUEUE_TABS.find((t) => t.id === tab);
  if (byId) return byId;
  const byState = QUEUE_TABS.find((t) => t.states.includes(legacyState as CaptureState));
  return byState ?? QUEUE_TABS[0]!;
}

/**
 * A search term reduced to characters that cannot break out of a PostgREST
 * `or=(…ilike…)` filter. Null when nothing searchable is left.
 */
export function searchTerm(raw?: string | null): string | null {
  const cleaned = (raw ?? "")
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned.length >= 2 ? cleaned : null;
}

/**
 * Where to go after deciding `currentId`: the item after it, else the one
 * before it. Chosen by ID before the list refreshes, so an item that leaves
 * the list never causes the next one to be skipped.
 */
export function nextSelection(ids: string[], currentId: string): string | null {
  const index = ids.indexOf(currentId);
  if (index === -1) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** Reasons that fill the student message in one tap. */
export const MESSAGE_PRESETS = [
  "An ID card, schedule or screen is readable. Please reshoot with it out of frame.",
  "It's too dark or blurry to use. Try again facing the light.",
  "It doesn't show what the prompt asked for.",
  "Someone in it isn't tagged. Tag everyone you can recognise.",
  "It needs to be vertical. Hold the phone upright.",
] as const;
