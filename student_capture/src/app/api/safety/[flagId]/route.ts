import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json } from "@/lib/http";

/** Marks a student safety report as handled. */
export async function POST(_request: Request, { params }: { params: Promise<{ flagId: string }> }) {
  const { flagId } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") {
    return fail(403, "Only the marketing desk can handle safety reports.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("safety_flags")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: person.id })
    .eq("id", flagId)
    .is("acknowledged_at", null)
    .select("id")
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "That report was already handled or does not exist.");
  return json({ ok: true });
}
