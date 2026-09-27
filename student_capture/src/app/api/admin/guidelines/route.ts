import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { guidelineSetSchema, withItemIds } from "@/lib/guideline-edit";

/** Creates a checklist with its first version. */
export async function POST(request: Request) {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only an administrator can create checklists.");
  const parsed = guidelineSetSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "Give the checklist a name and at least one line of three characters or more.");
  const input = parsed.data;
  const supabase = await createClient();
  const { data: set, error } = await supabase
    .from("guideline_sets")
    .insert({ org_id: person.org_id, name: input.name, kind: input.kind })
    .select("id")
    .single();
  if (error) return fail(500, error.message);
  const { error: versionError } = await supabase.from("guideline_versions").insert({
    set_id: set.id,
    version: 1,
    body: { summary: input.summary, items: withItemIds(input.items) },
  });
  if (versionError) return fail(500, versionError.message);
  return json({ ok: true, id: set.id });
}
