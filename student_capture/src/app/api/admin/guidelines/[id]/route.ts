import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json, readJson } from "@/lib/http";
import { guidelineSetSchema, withItemIds } from "@/lib/guideline-edit";

/**
 * Saves a checklist as a new version. The old version is kept and marked
 * superseded, so every capture still records the wording it was shot under.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "admin") return fail(403, "Only an administrator can change checklists.");
  const parsed = guidelineSetSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "Give the checklist a name and at least one line of three characters or more.");
  const input = parsed.data;

  const supabase = await createClient();
  const { data: set, error: setError } = await supabase
    .from("guideline_sets").update({ name: input.name, kind: input.kind }).eq("id", id).select("id").maybeSingle();
  if (setError) return fail(500, setError.message);
  if (!set) return fail(404, "That checklist isn't in your school.");

  const { data: latest } = await supabase
    .from("guideline_versions").select("version").eq("set_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  const now = new Date().toISOString();
  const { error: supersedeError } = await supabase
    .from("guideline_versions").update({ superseded_at: now }).eq("set_id", id).is("superseded_at", null);
  if (supersedeError) return fail(500, supersedeError.message);
  const { error } = await supabase.from("guideline_versions").insert({
    set_id: id,
    version: (latest?.version ?? 0) + 1,
    body: { summary: input.summary, items: withItemIds(input.items) },
    effective_from: now,
  });
  if (error) return fail(500, error.message);
  return json({ ok: true, version: (latest?.version ?? 0) + 1 });
}
