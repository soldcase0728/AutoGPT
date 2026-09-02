import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "student") return fail(403, "Only the student who sent this can withdraw it.");

  const body = await readJson<{ reason?: string }>(request);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("withdraw_capture", {
    p_capture_id: id,
    p_reason: body?.reason?.trim() || null,
  });

  if (error) {
    if (error.code === "42501") return fail(403, "That submission is not yours.");
    if (error.code === "23514") return fail(409, error.message);
    return fail(500, error.message);
  }
  return json({ ok: true, ...(data as { status: string; request_id?: string }) });
}
