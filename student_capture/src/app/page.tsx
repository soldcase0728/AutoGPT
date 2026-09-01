import { redirect } from "next/navigation";
import { TodayView } from "@/components/views/TodayView";
import { createClient } from "@/lib/supabase/server";
import { hasSignedRelease, requirePerson } from "@/lib/session";
import { buildChecklist } from "@/lib/guidelines";
import type { GuidelineVersion, Idea } from "@/lib/types";
import { isoDate } from "@/lib/assign";
import { RELEASE_VERSION } from "@/app/consent/version";

export const dynamic = "force-dynamic";

export default async function Today() {
  const person = await requirePerson();

  if (person.role === "student" && !(await hasSignedRelease(person.id, RELEASE_VERSION))) {
    redirect("/consent");
  }

  const supabase = await createClient();
  const today = isoDate(new Date());

  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, due_on, completed_at, ideas!inner(id, title, brief, format_spec, reference_urls, guideline_set_ids, campaigns(name))",
    )
    .eq("person_id", person.id)
    .eq("due_on", today)
    .maybeSingle();

  const idea = (assignment?.ideas ?? null) as unknown as
    | (Idea & { campaigns?: { name: string } })
    | null;

  let versions: GuidelineVersion[] = [];
  if (idea?.guideline_set_ids?.length) {
    const { data } = await supabase
      .from("guideline_versions")
      .select("id, set_id, version, body")
      .in("set_id", idea.guideline_set_ids)
      .is("superseded_at", null);
    versions = (data ?? []) as GuidelineVersion[];
  }

  return (
    <TodayView
      person={person}
      assignment={assignment ? { id: assignment.id, completed_at: assignment.completed_at } : null}
      idea={idea}
      checklist={buildChecklist(versions)}
    />
  );
}
