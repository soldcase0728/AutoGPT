import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can decide withdrawal requests.");
  }

  const body = await readJson<{ decision?: "approved" | "denied"; reason?: string }>(request);
  if (body?.decision !== "approved" && body?.decision !== "denied") {
    return fail(400, "decision must be approved or denied.");
  }
  if (body.decision === "denied" && !body.reason?.trim()) {
    return fail(400, "Explain why the withdrawal cannot be completed yet.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_capture_withdrawal", {
    p_request_id: requestId,
    p_decision: body.decision,
    p_reason: body.reason?.trim() || null,
  });
  if (error) return fail(error.code === "42501" ? 403 : 409, error.message);
  return json({ ok: true, state: data });
}
