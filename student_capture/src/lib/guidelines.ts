import type { GuidelineItem, GuidelineVersion } from "./types";

export interface Checklist {
  /** Every guideline version in force, so the capture can record what it was shot under. */
  versionIds: string[];
  items: GuidelineItem[];
  summaries: string[];
}

/** Flattens the guideline versions that apply to an idea into one checklist. */
export function buildChecklist(versions: GuidelineVersion[]): Checklist {
  const seen = new Set<string>();
  const items: GuidelineItem[] = [];

  for (const version of versions) {
    for (const item of version.body?.items ?? []) {
      // Two sets can carry the same rule; show it once.
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }

  // Required rules first — they are the ones that gate the capture button.
  items.sort((a, b) => Number(b.required) - Number(a.required));

  return {
    versionIds: versions.map((v) => v.id),
    items,
    summaries: versions.map((v) => v.body?.summary).filter(Boolean) as string[],
  };
}

export function requiredIds(checklist: Checklist): string[] {
  return checklist.items.filter((i) => i.required).map((i) => i.id);
}

export function checklistSatisfied(checklist: Checklist, ticked: string[]): boolean {
  const set = new Set(ticked);
  return requiredIds(checklist).every((id) => set.has(id));
}
