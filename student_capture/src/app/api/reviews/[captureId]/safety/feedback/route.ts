import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { findingBelongsToCapture, screenBelongsToCapture } from "@/lib/safety/review-access";

interface Body {
  screenId: string;
  findingId?: string;
  label: "true_positive" | "false_positive" | "false_negative" | "true_negative" | "unsure";
  category?: string;
  note?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  const { captureId } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") return fail(403, "Staff only.");
  const body = await readJson<Body>(request);
  if (!body?.screenId || !body.label) return fail(400, "Screen and feedback label are required.");
  const supabase = await createClient();
  if (!await screenBelongsToCapture(supabase, body.screenId, captureId)
      || (body.findingId && !await findingBelongsToCapture(supabase, body.findingId, captureId))) {
    return fail(404, "Safety feedback target was not found for this capture.");
  }
  const { error } = await supabase.rpc("record_safety_feedback", {
    p_screen_id: body.screenId, p_finding_id: body.findingId ?? null,
    p_label: body.label, p_category: body.category ?? null, p_note: body.note?.trim() || null,
  });
  if (error) return fail(error.code === "42501" ? 403 : 409, error.message);
  return json({ ok: true });
}
