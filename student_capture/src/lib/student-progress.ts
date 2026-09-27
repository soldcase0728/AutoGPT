import type { SupabaseClient } from "@supabase/supabase-js";
import { isoDate } from "./assign";
import { assignmentStatuses, type TaskAssignment, type TaskCapture } from "./task-progress";
import {
  parseCommunityStats,
  parseTeamBoard,
  recentPost,
  studentRecord,
  type CommunityStats,
  type PostedCapture,
  type StudentRecord,
  type TeamBoard,
} from "./student-record";
import type { CaptureState } from "./types";

export interface StudentProgress {
  record: StudentRecord;
  recent: PostedCapture | null;
  community: CommunityStats | null;
  /** Null until the team-board migration is applied. */
  board: TeamBoard | null;
}

/** Everything the student's record needs, read as the student through RLS. */
export async function loadStudentProgress(
  supabase: SupabaseClient,
  personId: string,
  now = new Date(),
): Promise<StudentProgress> {
  const [{ data: assignmentRows }, { data: captureRows }, community, board] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, due_on")
      .eq("person_id", personId)
      .order("due_on", { ascending: false })
      .limit(200),
    supabase
      .from("captures")
      .select("id, assignment_id, state, submitted_at, state_changed_at, prompt:ideas!captures_prompt_id_fkey(title)")
      .eq("person_id", personId)
      .order("created_at", { ascending: false })
      .limit(300),
    // Absent until the community-stats migration is applied; the record still shows.
    supabase.rpc("my_community_stats").then(
      ({ data, error }) => (error ? null : parseCommunityStats(data)),
      () => null,
    ),
    supabase.rpc("my_team_board").then(
      ({ data, error }) => (error ? null : parseTeamBoard(data)),
      () => null,
    ),
  ]);

  const assignments: TaskAssignment[] = ((assignmentRows ?? []) as Array<{ id: string; due_on: string }>).map(
    (row) => ({ id: row.id, personId, dueOn: row.due_on }),
  );
  const captures = (captureRows ?? []) as unknown as Array<{
    id: string;
    assignment_id: string | null;
    state: CaptureState;
    submitted_at: string | null;
    state_changed_at: string;
    prompt: { title: string } | null;
  }>;
  const statuses = assignmentStatuses(
    assignments,
    captures.map((c): TaskCapture => ({
      assignmentId: c.assignment_id,
      state: c.state,
      submittedAt: c.submitted_at,
      stateChangedAt: c.state_changed_at,
    })),
    isoDate(now),
  );

  const published = captures.filter((c) => c.state === "published");
  const newest = recentPost(
    published.map((c) => ({ id: c.id, title: c.prompt?.title ?? "your prompt", postedAt: c.state_changed_at, postUrl: null })),
    now,
  );
  // Read separately so this still works before the post-link migration.
  if (newest) {
    const { data: link, error } = await supabase.from("captures").select("post_url").eq("id", newest.id).maybeSingle();
    if (!error) newest.postUrl = (link as { post_url: string | null } | null)?.post_url ?? null;
  }

  return {
    record: studentRecord(assignments, statuses, isoDate(now), published.length),
    recent: newest,
    community,
    board,
  };
}
