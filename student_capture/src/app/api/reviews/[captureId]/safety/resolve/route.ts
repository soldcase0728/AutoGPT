import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { findingBelongsToCapture } from "@/lib/safety/review-access";

interface Body { findingId: string; resolution: "accepted_context" | "false_positive" | "addressed"; reason: string }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  const { captureId } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") return fail(403, "Staff only.");
  const body = await readJson<Body>(request);
  if (!body?.findingId || !body?.resolution || !body.reason?.trim()) {
    return fail(400, "Finding, resolution, and reason are required.");
  }
  const supabase = await createClient();
  if (!await findingBelongsToCapture(supabase, body.findingId, captureId)) {
    return fail(404, "Safety finding was not found for this capture.");
  }
  const { error } = await supabase.rpc("resolve_safety_finding", {
    p_finding_id: body.findingId, p_resolution: body.resolution, p_reason: body.reason.trim(),
  });
  if (error) return fail(error.code === "42501" ? 403 : 409, error.message);
  return json({ ok: true });
}
