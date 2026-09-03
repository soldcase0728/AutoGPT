import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json } from "@/lib/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("begin_capture_resubmission", { p_capture_id: id });
  if (error) return fail(error.code === "42501" ? 403 : 409, error.message);
  return json({ ok: true, mediaRevision: data });
}
