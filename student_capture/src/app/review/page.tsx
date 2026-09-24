import { AppHeader } from "@/components/AppHeader";
import type { ScanTiming } from "@/components/AutomatedSafetyReview";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { QUEUE_TABS, resolveTab, searchTerm, type QueueTabId } from "@/lib/queue";
import type { CaptureSafetyReview, QueueRow, SafetyFinding } from "@/lib/types";
import {
  ReviewQueue,
  type CaptureExtras,
  type SafetyReportRow,
  type WithdrawalRow,
} from "./ReviewQueue";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; state?: string; q?: string; task?: string }>;
}) {
  const person = await requireStaff();
  const params = await searchParams;
  const tab = resolveTab(params.tab, params.state);
  const term = searchTerm(params.q);
  const taskId = params.task && UUID.test(params.task) ? params.task : null;
  const supabase = await createClient();

  let query = supabase
    .from("review_queue")
    .select("*")
    .in("state", tab.states)
    .order(tab.newestFirst ? "state_changed_at" : "submitted_at", {
      ascending: !tab.newestFirst,
      nullsFirst: false,
    })
    .limit(200);
  if (taskId) query = query.eq("idea_id", taskId);
  if (term) query = query.or(`student.ilike.%${term}%,idea_title.ilike.%${term}%,one_liner.ilike.%${term}%`);

  // Counts follow the task filter but not the search, so the tabs stay a map of
  // the whole queue while you look for one thing.
  const countQueries = QUEUE_TABS.map((t) => {
    let count = supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .in("state", t.states);
    if (taskId) count = count.eq("idea_id", taskId);
    return count;
  });

  const [{ data, error }, { data: withdrawalRequests }, { data: reports }, taskRow, ...countResults] =
    await Promise.all([
      query,
      supabase
        .from("capture_withdrawal_requests")
        .select("id, capture_id, reason, requested_at")
        .is("decision", null)
        .order("requested_at", { ascending: true })
        .limit(100),
      supabase
        .from("safety_flags")
        .select("id, kind, detail, created_at, capture_id, reporter:people!safety_flags_reported_by_fkey(display_name), idea:ideas(title)")
        .is("acknowledged_at", null)
        .order("created_at", { ascending: true })
        .limit(50),
      taskId
        ? supabase.from("ideas").select("id, title").eq("id", taskId).maybeSingle()
        : Promise.resolve({ data: null }),
      ...countQueries,
    ]);

  const counts = Object.fromEntries(
    QUEUE_TABS.map((t, i) => [t.id, countResults[i]?.count ?? 0]),
  ) as Record<QueueTabId, number>;

  const rows = (data ?? []) as QueueRow[];
  const captureIds = rows.map((row) => row.id);

  const [
    { data: safetySummaries },
    { data: screens },
    { data: tags },
    { data: messages },
    { data: internalNotes },
    { data: openers },
  ] = captureIds.length
    ? await Promise.all([
        supabase.from("review_safety_summary").select("*").in("capture_id", captureIds),
        supabase.from("safety_screens").select("id, created_at, started_at").in("capture_id", captureIds),
        supabase
          .from("capture_people")
          .select("capture_id, person_id, people(display_name)")
          .in("capture_id", captureIds),
        supabase
          .from("reviews")
          .select("capture_id, state, note, created_at")
          .in("capture_id", captureIds)
          .not("note", "is", null)
          .order("created_at", { ascending: false }),
        // Absent until the review-messages migration is applied; the page still works.
        supabase
          .from("review_internal_notes")
          .select("capture_id, note, created_at, author:people(display_name)")
          .in("capture_id", captureIds)
          .order("created_at", { ascending: false }),
        supabase
          .from("people")
          .select("id, display_name")
          .in("id", [...new Set(rows.flatMap((row) => (row.review_started_by ? [row.review_started_by] : [])))]),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const screenIds = (safetySummaries ?? []).map((row) => row.safety_screen_id);
  const { data: safetyFindings } = screenIds.length
    ? await supabase.from("safety_findings")
        .select("id,safety_screen_id,submission_media_id,category,severity,confidence,description,start_ms,end_ms,bounding_box,detector,resolution_status,resolution_reason")
        .in("safety_screen_id", screenIds).order("created_at")
    : { data: [] };
  const findingsByScreen = new Map<string, SafetyFinding[]>();
  for (const finding of (safetyFindings ?? []) as SafetyFinding[]) {
    findingsByScreen.set(finding.safety_screen_id, [...(findingsByScreen.get(finding.safety_screen_id) ?? []), finding]);
  }
  const safetyReviews = (safetySummaries ?? []).map((summary) => ({
    ...summary,
    finding_count: Number(summary.finding_count),
    unresolved_finding_count: Number(summary.unresolved_finding_count),
    findings: findingsByScreen.get(summary.safety_screen_id) ?? [],
  })) as CaptureSafetyReview[];

  const screenTiming = new Map(
    ((screens ?? []) as Array<{ id: string; created_at: string; started_at: string | null }>).map(
      (screen) => [screen.id, { createdAt: screen.created_at, startedAt: screen.started_at }],
    ),
  );
  const openerNames = new Map(
    ((openers ?? []) as Array<{ id: string; display_name: string }>).map((p) => [p.id, p.display_name]),
  );

  // Post links, read separately so the queue still loads before that migration.
  const postUrls = new Map<string, string>();
  const publishedIds = rows.filter((row) => row.state === "published").map((row) => row.id);
  if (publishedIds.length) {
    const { data: links, error: linkError } = await supabase
      .from("captures")
      .select("id, post_url")
      .in("id", publishedIds);
    if (!linkError) {
      for (const link of (links ?? []) as Array<{ id: string; post_url: string | null }>) {
        if (link.post_url) postUrls.set(link.id, link.post_url);
      }
    }
  }

  const extras: Record<string, CaptureExtras> = {};
  for (const row of rows) {
    const summary = safetyReviews.find((review) => review.capture_id === row.id);
    extras[row.id] = {
      tagged: ((tags ?? []) as unknown as Array<{ capture_id: string; person_id: string; people: { display_name: string } | null }>)
        .filter((tag) => tag.capture_id === row.id)
        .map((tag) => ({ personId: tag.person_id, name: tag.people?.display_name ?? "Someone" })),
      messages: ((messages ?? []) as Array<{ capture_id: string; state: string; note: string; created_at: string }>)
        .filter((message) => message.capture_id === row.id)
        .map((message) => ({ state: message.state, note: message.note, at: message.created_at })),
      internalNotes: ((internalNotes ?? []) as unknown as Array<{ capture_id: string; note: string; created_at: string; author: { display_name: string } | null }>)
        .filter((note) => note.capture_id === row.id)
        .map((note) => ({ note: note.note, at: note.created_at, author: note.author?.display_name ?? "Staff" })),
      openedBy: row.review_started_by
        ? row.review_started_by === person.id
          ? "you"
          : (openerNames.get(row.review_started_by) ?? "another reviewer")
        : null,
      postUrl: postUrls.get(row.id) ?? null,
      scanTiming: summary ? screenTiming.get(summary.safety_screen_id) as ScanTiming | undefined : undefined,
    };
  }

  const withdrawalCaptureIds = (withdrawalRequests ?? []).map((row) => row.capture_id);
  const { data: withdrawalCaptures } = withdrawalCaptureIds.length
    ? await supabase
        .from("review_queue")
        .select("id, student, idea_title")
        .in("id", withdrawalCaptureIds)
    : { data: [] };
  const withdrawalCaptureById = new Map(
    (withdrawalCaptures ?? []).map((row) => [row.id, row]),
  );
  const withdrawals: WithdrawalRow[] = (withdrawalRequests ?? []).flatMap((request) => {
    const capture = withdrawalCaptureById.get(request.capture_id);
    return capture ? [{
      id: request.id,
      captureId: request.capture_id,
      student: capture.student,
      ideaTitle: capture.idea_title,
      reason: request.reason,
      requestedAt: request.requested_at,
    }] : [];
  });

  const safetyReports: SafetyReportRow[] = ((reports ?? []) as unknown as Array<{
    id: string; kind: string; detail: string; created_at: string; capture_id: string | null;
    reporter: { display_name: string } | null; idea: { title: string } | null;
  }>).map((report) => ({
    id: report.id,
    kind: report.kind,
    detail: report.detail,
    createdAt: report.created_at,
    reporter: report.reporter?.display_name ?? "Someone",
    ideaTitle: report.idea?.title ?? null,
  }));

  const task = (taskRow as { data: { id: string; title: string } | null }).data;

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-6xl px-5 py-6">
        {error ? (
          <p className="text-sm" style={{ color: "var(--clay)" }}>
            {error.message}
          </p>
        ) : (
          <ReviewQueue
            key={`${tab.id}:${term ?? ""}:${taskId ?? ""}`}
            rows={rows}
            tab={tab.id}
            counts={counts}
            search={term ?? ""}
            task={task}
            extras={extras}
            withdrawals={withdrawals}
            safetyReports={safetyReports}
            safetyReviews={safetyReviews}
          />
        )}
      </main>
    </>
  );
}
