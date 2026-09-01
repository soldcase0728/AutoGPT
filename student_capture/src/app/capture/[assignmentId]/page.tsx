import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { PromptCard } from "@/components/PromptCard";
import { createClient } from "@/lib/supabase/server";
import { hasSignedRelease, requirePerson } from "@/lib/session";
import { buildChecklist } from "@/lib/guidelines";
import { publicEnv } from "@/lib/env";
import type { GuidelineVersion, Idea } from "@/lib/types";
import { RELEASE_VERSION } from "@/app/consent/version";
import { CaptureFlow } from "./CaptureFlow";

export const dynamic = "force-dynamic";

export default async function CapturePage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const person = await requirePerson();
  if (person.role === "student" && !(await hasSignedRelease(person.id, RELEASE_VERSION))) {
    redirect("/consent");
  }

  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, person_id, completed_at, ideas!inner(id, title, brief, format_spec, reference_urls, guideline_set_ids, campaigns(name))",
    )
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment || assignment.person_id !== person.id) notFound();
  if (assignment.completed_at) redirect("/submissions");

  const idea = assignment.ideas as unknown as Idea & { campaigns?: { name: string } };

  const { data: versionRows } = await supabase
    .from("guideline_versions")
    .select("id, set_id, version, body")
    .in("set_id", idea.guideline_set_ids ?? [])
    .is("superseded_at", null);

  const checklist = buildChecklist((versionRows ?? []) as GuidelineVersion[]);

  // Everyone taggable as "in frame". Reviewers and admins are included: staff
  // turn up in student footage all the time, and they need consent too.
  const { data: people } = await supabase
    .from("people")
    .select("id, display_name")
    .eq("org_id", person.org_id)
    .is("deactivated_at", null)
    .order("display_name");

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
        <PromptCard
          title={idea.title}
          brief={idea.brief}
          spec={idea.format_spec}
          campaign={idea.campaigns?.name}
        />
        <CaptureFlow
          assignmentId={assignment.id}
          ideaId={idea.id}
          spec={idea.format_spec}
          checklist={checklist}
          people={(people ?? []) as Array<{ id: string; display_name: string }>}
          self={{ id: person.id, display_name: person.display_name }}
          maxBytes={publicEnv.maxUploadBytes()}
          supabaseUrl={publicEnv.supabaseUrl()}
        />
      </main>
    </>
  );
}
