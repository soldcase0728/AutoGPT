import { z } from "zod";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
// PostgreSQL accepts the fixed UUID-shaped identifiers used by the seed data,
// even when their version/variant bits are not RFC-generated values.
const databaseId = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);

export const taskCreateSchema = z
  .object({
    campaignId: databaseId,
    title: z.string().trim().min(3).max(120),
    brief: z.string().trim().min(10).max(2000),
    mediaType: z.enum(["video", "photo", "photo_series"]),
    orientation: z.enum(["portrait", "landscape", "square", "any"]),
    startsOn: z.string().regex(isoDate),
    endsOn: z.string().regex(isoDate),
    studentIds: z.array(databaseId).min(1).max(250),
    guidelineSetIds: z.array(databaseId).max(20).default([]),
    minMediaCount: z.number().int().min(1).max(4),
    maxMediaCount: z.number().int().min(1).max(4),
    minDurationSeconds: z.number().min(0).max(600).nullable(),
    maxDurationSeconds: z.number().positive().max(600).nullable(),
    captionRequired: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    const dates = expandTaskDates(value.startsOn, value.endsOn);
    if (!dates) {
      context.addIssue({ code: "custom", path: ["endsOn"], message: "Choose a range of 31 days or fewer." });
    }
    if (value.minMediaCount > value.maxMediaCount) {
      context.addIssue({ code: "custom", path: ["maxMediaCount"], message: "Maximum must be at least the minimum." });
    }
    if (value.mediaType !== "photo_series" && (value.minMediaCount !== 1 || value.maxMediaCount !== 1)) {
      context.addIssue({ code: "custom", path: ["maxMediaCount"], message: "A single photo or video must have a count of 1." });
    }
    if (value.mediaType === "video") {
      if (value.minDurationSeconds === null || value.maxDurationSeconds === null) {
        context.addIssue({ code: "custom", path: ["maxDurationSeconds"], message: "Video tasks need minimum and maximum durations." });
      } else if (value.minDurationSeconds > value.maxDurationSeconds) {
        context.addIssue({ code: "custom", path: ["maxDurationSeconds"], message: "Maximum duration must be at least the minimum." });
      }
    }
  });

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

/** Inclusive UTC date expansion. Returns null for invalid, reversed, or overly broad ranges. */
export function expandTaskDates(start: string, end: string, maxDays = 31): string[] | null {
  if (!isoDate.test(start) || !isoDate.test(end)) return null;
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (
    Number.isNaN(first.getTime()) ||
    Number.isNaN(last.getTime()) ||
    first.toISOString().slice(0, 10) !== start ||
    last.toISOString().slice(0, 10) !== end ||
    first > last
  ) return null;

  const result: string[] = [];
  for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    if (result.length >= maxDays) return null;
    result.push(day.toISOString().slice(0, 10));
  }
  return result;
}
