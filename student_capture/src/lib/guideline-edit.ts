import { z } from "zod";

export const guidelineItemSchema = z.object({
  id: z.string().trim().max(60).optional().default(""),
  text: z.string().trim().min(3).max(240),
  required: z.boolean(),
  safety: z.boolean().default(false),
});

export const guidelineSetSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["craft", "brand"]),
  summary: z.string().trim().max(240).default(""),
  items: z.array(guidelineItemSchema).min(1).max(30),
});

export type GuidelineItemInput = z.infer<typeof guidelineItemSchema>;

/**
 * Stable item IDs. An item that keeps its ID across versions keeps its place in
 * capture records (checklist_ticked); a new item gets a slug of its text.
 */
export function withItemIds(items: GuidelineItemInput[]) {
  const used = new Set<string>();
  return items.map((item) => {
    let id = item.id || item.text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
    const base = id;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return { id, text: item.text, required: item.safety ? true : item.required, ...(item.safety ? { safety: true } : {}) };
  });
}
