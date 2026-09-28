import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeCutoff, cutoffFor, schoolToday } from "./dates";
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

export interface StudentAward {
  id: string;
  captureId: string;
  awardedOn: string;
  note: string | null;
  title: string;
  postUrl: string | null;
}

export interface StudentProgress {
  record: StudentRecord;
  /** Shot of the Day awards on shots the school still has, newest first. */
  awards: StudentAward[];
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
  const [{ data: assignmentRows }, { data: captureRows }, community, board, awardRows] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, due_on")
      .eq("person_id", personId)
      .order("due_on", { ascending: false })
      .limit(200),
    supabase
      .from("captures")
      .select("id, assignment_id, state, submitted_at, state_changed_at, media_revision, prompt:ideas!captures_prompt_id_fkey(title)")
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
    // Absent until the Shot of the Day migration is applied.
    supabase
      .from("shot_awards")
      .select("id, capture_id, awarded_on, note")
      .order("awarded_on", { ascending: false })
      .limit(50)
      .then(
        ({ data, error }) =>
          error ? [] : ((data ?? []) as Array<{ id: string; capture_id: string; awarded_on: string; note: string | null }>),
        () => [],
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
    media_revision: number | null;
    prompt: { title: string } | null;
  }>;
  const statuses = assignmentStatuses(
    assignments,
    captures.map((c): TaskCapture => ({
      assignmentId: c.assignment_id,
      state: c.state,
      submittedAt: c.submitted_at,
      stateChangedAt: c.state_changed_at,
      mediaRevision: c.media_revision ?? 1,
    })),
    schoolToday(now),
  );

  // Sent by 9 pm on its day. A reshoot counts from the first send, which the
  // desk already had on time or not; its new send time doesn't take it away.
  const dueOn = new Map(assignments.map((a) => [a.id, a.dueOn]));
  const onTime = new Map<string, boolean>();
  for (const c of captures) {
    const day = c.assignment_id ? dueOn.get(c.assignment_id) : undefined;
    if (!day || !c.assignment_id) continue;
    const inTime = (c.media_revision ?? 1) > 1 || (c.submitted_at !== null && new Date(c.submitted_at) <= cutoffFor(day));
    onTime.set(c.assignment_id, (onTime.get(c.assignment_id) ?? false) || inTime);
  }

  const published = captures.filter((c) => c.state === "published");
  const newest = recentPost(
    published.map((c) => ({ id: c.id, title: c.prompt?.title ?? "your prompt", postedAt: c.state_changed_at, postUrl: null })),
    now,
  );
  // An award only counts while the school still has the shot.
  const kept = new Map(published.map((c) => [c.id, c]));
  for (const c of captures) if (c.state === "approved") kept.set(c.id, c);
  const awardList = awardRows.filter((a) => kept.has(a.capture_id));

  // Post links, read separately so this still works before the post-link migration.
  const linkIds = [...new Set([...(newest ? [newest.id] : []), ...awardList.map((a) => a.capture_id)])];
  const links = new Map<string, string>();
  if (linkIds.length) {
    const { data: linkRows, error } = await supabase.from("captures").select("id, post_url").in("id", linkIds);
    if (!error) {
      for (const row of (linkRows ?? []) as Array<{ id: string; post_url: string | null }>) {
        if (row.post_url) links.set(row.id, row.post_url);
      }
    }
  }
  if (newest) newest.postUrl = links.get(newest.id) ?? null;
  const awards: StudentAward[] = awardList.map((a) => ({
    id: a.id,
    captureId: a.capture_id,
    awardedOn: a.awarded_on,
    note: a.note,
    title: kept.get(a.capture_id)?.prompt?.title ?? "your prompt",
    postUrl: links.get(a.capture_id) ?? null,
  }));


  return {
    record: studentRecord(assignments, statuses, schoolToday(now), published.length, {
      todayOpen: beforeCutoff(schoolToday(now), now),
      onTime,
    }),
    awards,
    recent: newest,
    community,
    board,
  };
}
