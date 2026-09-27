import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const campaignSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    startsOn: isoDate,
    endsOn: isoDate.nullable(),
    active: z.boolean().default(true),
  })
  .refine((c) => !c.endsOn || c.endsOn >= c.startsOn, { message: "The end date has to be on or after the start date." });
