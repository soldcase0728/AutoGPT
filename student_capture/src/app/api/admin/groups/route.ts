import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["team", "grade", "program", "list"]),
  personIds: z.array(z.string().uuid()).min(1).max(500),
});

/** Saves a group of students. Saving over an existing name replaces its members. */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only an administrator can save groups.");
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "Give the group a name and pick at least one student.");
  const input = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("student_groups")
    .select("id")
    .eq("org_id", person.org_id)
    .ilike("name", input.name.replace(/[%_\\]/g, (c) => `\\${c}`))
    .maybeSingle();

  let groupId = existing?.id as string | undefined;
  if (groupId) {
    const { error } = await supabase.from("student_groups").update({ kind: input.kind }).eq("id", groupId);
    if (error) return fail(500, error.message);
    const { error: clearError } = await supabase.from("student_group_members").delete().eq("group_id", groupId);
    if (clearError) return fail(500, clearError.message);
  } else {
    const { data, error } = await supabase
      .from("student_groups")
      .insert({ org_id: person.org_id, name: input.name, kind: input.kind, created_by: person.id })
      .select("id")
      .single();
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return fail(503, "Groups need the latest database migration. See student_capture/README.md.");
      }
      return fail(500, error.message);
    }
    groupId = data.id;
  }

  const { error: memberError } = await supabase
    .from("student_group_members")
    .insert([...new Set(input.personIds)].map((person_id) => ({ group_id: groupId, person_id })));
  if (memberError) return fail(memberError.code === "42501" ? 400 : 500, "Some of those students aren't on your roster.");

  return json({ ok: true, id: groupId, replaced: Boolean(existing) });
}
