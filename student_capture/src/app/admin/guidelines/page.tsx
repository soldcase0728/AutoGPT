import { AppHeader } from "@/components/AppHeader";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { GuidelineVersion } from "@/lib/types";
import { GuidelineManager, type ChecklistSet } from "./GuidelineManager";

export const dynamic = "force-dynamic";

export default async function GuidelinesPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { data: sets } = await supabase
    .from("guideline_sets").select("id, name, kind").eq("org_id", me.org_id).order("kind").order("name");
  const ids = (sets ?? []).map((s) => s.id);
  const { data: versions } = ids.length
    ? await supabase.from("guideline_versions").select("id, set_id, version, body").in("set_id", ids).is("superseded_at", null)
    : { data: [] };
  const byId = new Map(((versions ?? []) as GuidelineVersion[]).map((v) => [v.set_id, v]));
  const checklists: ChecklistSet[] = (sets ?? []).map((s) => {
    const v = byId.get(s.id);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      version: v?.version ?? 0,
      summary: v?.body?.summary ?? "",
      items: (v?.body?.items ?? []).map((i) => ({ id: i.id, text: i.text, required: i.required, safety: Boolean(i.safety) })),
    };
  });
  return (
    <>
      <AppHeader person={me} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <GuidelineManager checklists={checklists} />
      </main>
    </>
  );
}
