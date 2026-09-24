import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json } from "@/lib/http";

/** Deletes a group. Its students are not affected. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only an administrator can delete groups.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("student_groups").delete().eq("id", id).select("id");
  if (error) return fail(500, error.message);
  if (!data?.length) return fail(404, "That group doesn't exist.");
  return json({ ok: true });
}
