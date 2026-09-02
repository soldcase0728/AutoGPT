import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json } from "@/lib/http";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ captureId: string }> },
) {
  const { captureId } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can open reviews.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_capture_for_review", {
    p_capture_id: captureId,
  });
  if (error) return fail(error.code === "42501" ? 403 : 409, error.message);
  return json({ ok: true, state: data });
}
