import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { PromptCard } from "@/components/PromptCard";
import { createClient } from "@/lib/supabase/server";
import { hasSignedRelease, requirePerson } from "@/lib/session";
import { buildChecklist } from "@/lib/guidelines";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { objectLanded } from "@/lib/storage-landed";
import type { GuidelineVersion, Idea } from "@/lib/types";
import { RELEASE_VERSION } from "@/app/consent/version";
import { CaptureFlow, type ResumeState } from "./CaptureFlow";

export const dynamic = "force-dynamic";

export default async function CapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ resubmit?: string }>;
}) {
  const { assignmentId } = await params;
  const { resubmit } = await searchParams;
  const person = await requirePerson();
  if (person.role === "student" && !(await hasSignedRelease(person.id, RELEASE_VERSION))) {
    redirect("/consent");
  }

  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, person_id, completed_at, ideas!inner(id, active, title, brief, format_spec, reference_urls, guideline_set_ids, capture_mode, media_type, min_media_count, max_media_count, orientation, repeat_submission_policy, opens_at, closes_at, max_image_size, allowed_image_formats, min_image_width, min_image_height, min_duration_seconds, max_duration_seconds, caption_required, campaigns(name))",
    )
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment || assignment.person_id !== person.id) notFound();
  if (assignment.completed_at) redirect("/submissions");

  const idea = assignment.ideas as unknown as Idea & { active: boolean; campaigns?: { name: string } };
  if (!idea.active) {
    return (
      <>
        <AppHeader person={person} />
        <main className="mx-auto max-w-3xl px-5 py-8">
          <div className="card p-5">
            <h1 className="text-xl font-bold tracking-tight">This task is on hold</h1>
            <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>
              The marketing desk paused &ldquo;{idea.title}&rdquo;. Nothing to shoot for it right now.
            </p>
          </div>
        </main>
      </>
    );
  }

  // An earlier attempt that never reached "Send it": pick it back up instead of
  // starting a second submission beside it.
  const { data: pending } = await supabase
    .from("captures")
    .select("id, submitted_at, media_revision, created_at")
    .eq("assignment_id", assignment.id)
    .eq("person_id", person.id)
    .eq("state", "uploading")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let resume: ResumeState | undefined;
  if (pending) {
    const { data: mediaRows } = await supabase
      .from("submission_media")
      .select("id, media_type, bucket, storage_key, mime_type, file_size, client_media_id")
      .eq("submission_id", pending.id)
      .eq("media_revision", pending.media_revision)
      .order("sort_order");
    const rows = mediaRows ?? [];
    const admin = createAdminClient();
    const landed = await Promise.all(
      rows.map((row) => objectLanded(admin, row.bucket, row.storage_key)),
    );
    resume = {
      captureId: pending.id,
      startedAt: pending.created_at,
      isResubmission: Boolean(pending.submitted_at),
      complete:
        rows.length >= Math.max(idea.min_media_count, 1) && landed.every(Boolean),
      media: rows.map((row) => ({
        id: row.id,
        kind: row.media_type === "video" ? "video" : "photo",
        mimeType: row.mime_type ?? "",
        fileSize: Number(row.file_size ?? 0),
        clientMediaId: row.client_media_id,
      })),
    };
  }

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
          mediaType={idea.media_type}
          orientation={idea.orientation}
          minMediaCount={idea.min_media_count}
          maxMediaCount={idea.max_media_count}
          minDurationSeconds={idea.min_duration_seconds}
          maxDurationSeconds={idea.max_duration_seconds}
          campaign={idea.campaigns?.name}
        />
        <CaptureFlow
          initialCaptureId={resume?.isResubmission ? resume.captureId : resubmit}
          resume={resume}
          assignmentId={assignment.id}
          ideaId={idea.id}
          spec={idea.format_spec}
          mediaType={idea.media_type}
          orientation={idea.orientation}
          minMediaCount={idea.min_media_count}
          maxMediaCount={idea.max_media_count}
          captionRequired={idea.caption_required}
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
