import { AppHeader } from "@/components/AppHeader";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isoDate } from "@/lib/assign";
import { TaskManager, type TaskSummary } from "./TaskManager";

export const dynamic = "force-dynamic";

export default async function AdminTasksPage() {
  const person = await requireAdmin();
  const supabase = await createClient();
  const [{ data: campaigns }, { data: students }, { data: guidelineSets }, { data: ideas }] = await Promise.all([
    supabase.from("campaigns").select("id, name, starts_on, ends_on").eq("active", true).order("starts_on", { ascending: false }),
    supabase.from("people").select("id, display_name, email, participation").eq("org_id", person.org_id).eq("role", "student").is("deactivated_at", null).order("display_name"),
    supabase.from("guideline_sets").select("id, name, kind").eq("org_id", person.org_id).order("kind"),
    supabase
      .from("ideas")
      .select("id, title, brief, media_type, orientation, min_media_count, max_media_count, min_duration_seconds, max_duration_seconds, caption_required, guideline_set_ids, active, created_at, campaigns!inner(name, org_id), assignments(id, due_on)")
      .eq("campaigns.org_id", person.org_id)
      .eq("capture_mode", "ASSIGNED")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const tasks: TaskSummary[] = (ideas ?? []).map((idea) => {
    const assignments = (idea.assignments ?? []) as Array<{ id: string; due_on: string }>;
    const dates = assignments.map((assignment) => assignment.due_on).sort();
    const campaign = idea.campaigns as unknown as { name: string };
    return {
      id: idea.id,
      title: idea.title,
      brief: idea.brief,
      campaign: campaign.name,
      mediaType: idea.media_type,
      orientation: idea.orientation,
      minMediaCount: idea.min_media_count,
      maxMediaCount: idea.max_media_count,
      minDurationSeconds: idea.min_duration_seconds,
      maxDurationSeconds: idea.max_duration_seconds,
      captionRequired: idea.caption_required,
      guidelineSetIds: idea.guideline_set_ids,
      active: idea.active,
      assignmentCount: assignments.length,
      firstDueOn: dates[0] ?? null,
      lastDueOn: dates[dates.length - 1] ?? null,
    };
  });

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <TaskManager
          today={isoDate(new Date())}
          campaigns={campaigns ?? []}
          students={students ?? []}
          guidelineSets={guidelineSets ?? []}
          tasks={tasks}
        />
      </main>
    </>
  );
}
