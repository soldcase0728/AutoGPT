import { AppHeader } from "@/components/AppHeader";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isoDate } from "@/lib/assign";
import { TaskManager, type TaskSummary, type StudentGroup } from "./TaskManager";
import type { GuidelineVersion } from "@/lib/types";

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
      .select("id, title, brief, media_type, orientation, min_media_count, max_media_count, min_duration_seconds, max_duration_seconds, caption_required, guideline_set_ids, active, created_at, campaigns!inner(name, org_id), assignments(id, due_on, completed_at)")
      .eq("campaigns.org_id", person.org_id)
      .eq("capture_mode", "ASSIGNED")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const today = isoDate(new Date());
  const ideaIds = (ideas ?? []).map((idea) => idea.id);
  const setIds = (guidelineSets ?? []).map((set) => set.id);
  const [{ data: groups }, { data: members }, { data: versions }, { data: cancelled }] = await Promise.all([
    // Groups and cancelled_at arrive with the tasks-and-groups migration; until
    // it is applied these come back empty and the page still works.
    supabase.from("student_groups").select("id, name, kind").eq("org_id", person.org_id).order("name"),
    supabase.from("student_group_members").select("group_id, person_id"),
    setIds.length
      ? supabase.from("guideline_versions").select("id, set_id, version, body").in("set_id", setIds).is("superseded_at", null)
      : Promise.resolve({ data: [] }),
    ideaIds.length
      ? supabase.from("ideas").select("id, cancelled_at").in("id", ideaIds)
      : Promise.resolve({ data: [] }),
  ]);
  const cancelledIds = new Set(
    ((cancelled ?? []) as Array<{ id: string; cancelled_at: string | null }>).filter((i) => i.cancelled_at).map((i) => i.id),
  );
  const studentGroups: StudentGroup[] = ((groups ?? []) as Array<{ id: string; name: string; kind: string }>).map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    memberIds: ((members ?? []) as Array<{ group_id: string; person_id: string }>)
      .filter((m) => m.group_id === g.id)
      .map((m) => m.person_id),
  }));
  const guidelineText = Object.fromEntries(
    ((versions ?? []) as GuidelineVersion[]).map((v) => [v.set_id, (v.body?.items ?? []).map((item) => item.text)]),
  ) as Record<string, string[]>;

  const tasks: TaskSummary[] = (ideas ?? []).map((idea) => {
    const assignments = (idea.assignments ?? []) as Array<{ id: string; due_on: string; completed_at: string | null }>;
    const due = assignments.filter((a) => a.due_on <= today);
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
      cancelled: cancelledIds.has(idea.id),
      dueCount: due.length,
      sentCount: due.filter((a) => a.completed_at).length,
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
          groups={studentGroups}
          guidelineText={guidelineText}
        />
      </main>
    </>
  );
}
