import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

const awardSchema = z.object({
  captureId: z.string().uuid(),
  /** The admin's own calendar date, so an evening pick lands on their today. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(280).optional(),
});

/** An administrator makes a shot the Shot of the Day. */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only a school administrator can award Shot of the Day.");
  const parsed = awardSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "Choose a shot and a date.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("award_shot_of_the_day", {
    p_capture_id: parsed.data.captureId,
    p_date: parsed.data.date,
    p_note: parsed.data.note || null,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "23514" ? 409 : 500;
    return fail(status, status === 500 ? "That didn't save. Try again." : error.message);
  }
  return json({ id: data });
}

/** Take the award back. */
export async function DELETE(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only a school administrator can change Shot of the Day.");
  const body = await readJson<{ awardId?: unknown }>(request);
  const awardId = z.string().uuid().safeParse(body?.awardId);
  if (!awardId.success) return fail(400, "Which award?");

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_shot_of_the_day", { p_award_id: awardId.data });
  if (error) return fail(error.code === "42501" ? 403 : 500, "That didn't save. Try again.");
  return json({ ok: true });
}
