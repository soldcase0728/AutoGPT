import { DashboardView } from "@/components/views/DashboardView";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { schoolToday } from "@/lib/dates";
import { assignmentStatuses, type TaskAssignment, type TaskCapture } from "@/lib/task-progress";
import {
  attentionItems,
  dailyParticipation,
  daysAfter,
  daysEnding,
  quietStudents,
  upcomingDays,
} from "@/lib/dashboard";
import { needsParentalRelease, releaseStatus, type ConsentRecord } from "@/lib/people";
import type { CaptureState } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE = 1000;

/** Every row of a query, a page at a time, past PostgREST's row cap. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await page(from, from + PAGE - 1);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export default async function AdminOverviewPage() {
  const person = await requireAdmin();
  const supabase = await createClient();
  const now = new Date();
  const today = schoolToday(now);
  const past = daysEnding(today, 14);
  const lastWeek = past.slice(-7);
  const ahead = daysAfter(today, 7);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);

  const [
    { data: students },
    assignmentRows,
    captureRows,
    toReview,
    waitingOnStudent,
    readyToPost,
    postedThisWeek,
    { data: oldestToReview },
    { data: approved },
    queuedScans,
    { data: oldestScan },
    safetyReports,
    withdrawalRequests,
    { data: tasks },
  ] = await Promise.all([
    supabase
      .from("people")
      .select("id, display_name, email, birth_year, participation")
      .eq("org_id", person.org_id)
      .eq("role", "student")
      .is("deactivated_at", null)
      .order("display_name"),
    allRows((from, to) =>
      supabase
        .from("assignments")
        .select("id, person_id, due_on, ideas!inner(active)")
        .gte("due_on", past[0]!)
        .lte("due_on", ahead[ahead.length - 1]!)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("captures")
        .select("assignment_id, state, submitted_at, state_changed_at, media_revision")
        .not("assignment_id", "is", null)
        .gte("created_at", `${past[0]}T00:00:00Z`)
        .order("id")
        .range(from, to),
    ),
    count(supabase.from("review_queue").select("id", { count: "exact", head: true }).in("state", ["submitted", "in_review"])),
    count(supabase.from("review_queue").select("id", { count: "exact", head: true }).in("state", ["changes_requested", "uploading"])),
    count(supabase.from("review_queue").select("id", { count: "exact", head: true }).eq("state", "approved")),
    count(
      supabase
        .from("review_queue")
        .select("id", { count: "exact", head: true })
        .eq("state", "published")
        .gte("state_changed_at", weekAgo),
    ),
    supabase
      .from("review_queue")
      .select("submitted_at")
      .in("state", ["submitted", "in_review"])
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("review_queue").select("id, consent_blockers").eq("state", "approved").limit(500),
    count(supabase.from("safety_screens").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"])),
    supabase
      .from("safety_screens")
      .select("created_at")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    count(supabase.from("safety_flags").select("id", { count: "exact", head: true }).is("acknowledged_at", null)),
    count(supabase.from("capture_withdrawal_requests").select("id", { count: "exact", head: true }).is("decision", null)),
    supabase
      .from("ideas")
      .select("id, campaigns!inner(org_id), assignments(count)")
      .eq("campaigns.org_id", person.org_id)
      .eq("capture_mode", "ASSIGNED")
      .eq("active", true),
  ]);

  const roster = (students ?? []) as Array<{
    id: string; display_name: string; email: string; birth_year: number | null; participation: string;
  }>;
  const studentIds = roster.map((s) => s.id);
  const { data: consents } = studentIds.length
    ? await supabase
        .from("consents")
        .select("person_id, type, document_version, signed_at, signed_by, expires_at, revoked_at")
        .in("person_id", studentIds)
    : { data: [] };

  const assignments: TaskAssignment[] = (assignmentRows as Array<{ id: string; person_id: string; due_on: string }>).map(
    (a) => ({ id: a.id, personId: a.person_id, dueOn: a.due_on }),
  );
  const captures: TaskCapture[] = (captureRows as Array<{
    assignment_id: string | null; state: CaptureState; submitted_at: string | null; state_changed_at: string;
    media_revision: number | null;
  }>).map((c) => ({
    assignmentId: c.assignment_id,
    state: c.state,
    submittedAt: c.submitted_at,
    stateChangedAt: c.state_changed_at,
    mediaRevision: c.media_revision ?? 1,
  }));
  const statuses = assignmentStatuses(assignments, captures, today);

  const participation = dailyParticipation(assignments, statuses, past);
  const sentToday = participation[participation.length - 1]!;

  // Paused and cancelled tasks don't reach students, so they don't fill a day.
  const activeAhead = new Map<string, number>();
  for (const row of assignmentRows as unknown as Array<{ due_on: string; ideas: { active: boolean } | null }>) {
    if (row.due_on > today && row.ideas?.active) {
      activeAhead.set(row.due_on, (activeAhead.get(row.due_on) ?? 0) + 1);
    }
  }
  const upcoming = upcomingDays(ahead, activeAhead);

  const activeStudents = roster.filter((s) => s.participation === "active");
  const byId = new Map(roster.map((s) => [s.id, s]));
  const quiet = quietStudents(
    activeStudents.map((s) => ({ id: s.id, name: s.display_name })),
    assignments,
    statuses,
    lastWeek,
  ).map((q) => ({ ...q, email: byId.get(q.personId)?.email ?? "" }));

  const consentRows = (consents ?? []) as Array<ConsentRecord & { person_id: string }>;
  const needingParent = roster.filter(
    (s) =>
      needsParentalRelease(s.birth_year, now) &&
      releaseStatus(consentRows.filter((c) => c.person_id === s.id), "parental", { now }) !== "valid",
  ).length;

  const readyBlocked = ((approved ?? []) as Array<{ consent_blockers: unknown[] | null }>).filter(
    (row) => (row.consent_blockers ?? []).length > 0,
  ).length;

  const unassigned = ((tasks ?? []) as Array<{ assignments: Array<{ count: number }> | null }>).filter(
    (t) => (t.assignments?.[0]?.count ?? 0) === 0,
  ).length;

  const attention = attentionItems({
    now,
    oldestScanQueuedAt: (oldestScan as { created_at: string } | null)?.created_at ?? null,
    queuedScans,
    safetyReports,
    withdrawalRequests,
    approvedBlockedByRelease: readyBlocked,
    studentsAwaitingActivation: roster.filter((s) => s.participation === "pending").length,
    studentsNeedingParentRelease: needingParent,
    tasksWithNobodyAssigned: unassigned,
    nextGap: upcoming.find((d) => d.gap)?.date ?? null,
  });

  // Today's Shot of the Day, if one has been picked (absent before that migration).
  let shotOfTheDay: { student: string; title: string; note: string | null } | null = null;
  const { data: award } = await supabase
    .from("shot_awards").select("capture_id, note").eq("awarded_on", today).maybeSingle();
  if (award) {
    const { data: shot } = await supabase
      .from("review_queue").select("student, idea_title").eq("id", award.capture_id).maybeSingle();
    if (shot) shotOfTheDay = { student: shot.student, title: shot.idea_title, note: award.note };
  }

  return (
    <DashboardView
      shotOfTheDay={shotOfTheDay}
      person={person}
      today={today}
      now={now}
      sentToday={{ due: sentToday.due, sent: sentToday.sent }}
      queue={{
        toReview,
        oldestToReviewSince: (oldestToReview as { submitted_at: string } | null)?.submitted_at ?? null,
        waitingOnStudent,
        readyToPost,
        readyBlocked,
        postedThisWeek,
      }}
      attention={attention}
      participation={participation}
      upcoming={upcoming}
      quiet={quiet}
    />
  );
}
