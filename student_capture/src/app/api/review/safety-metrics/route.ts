import { createClient } from "@/lib/supabase/server";
import { currentPerson } from "@/lib/session";
import { fail, json } from "@/lib/http";

function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? null;
}

export async function GET() {
  const person = await currentPerson();
  if (!person) return fail(401, "Sign in first.");
  if (person.role !== "reviewer" && person.role !== "admin") return fail(403, "Staff only.");
  const supabase = await createClient();
  const [{ data: screens, error }, { data: feedback }] = await Promise.all([
    supabase.from("safety_screens").select(
      "status,processing_time_ms,estimated_cost_usd,provider_usage,captures(media_type,review_started_at,reviews(state,created_at))",
    )
      .order("created_at", { ascending: false }).limit(1000),
    supabase.from("safety_feedback").select("label,category").order("created_at", { ascending: false }).limit(5000),
  ]);
  if (error) return fail(500, error.message);
  const times = (screens ?? []).flatMap((screen) => screen.processing_time_ms == null ? [] : [Number(screen.processing_time_ms)]);
  const reviewerDecisionTimes = (screens ?? []).flatMap((screen) => {
    const capture = Array.isArray(screen.captures) ? screen.captures[0] : screen.captures;
    if (!capture?.review_started_at) return [];
    const started = new Date(capture.review_started_at).getTime();
    const decisions = (capture.reviews ?? [])
      .filter((review) => review.state !== "in_review")
      .map((review) => new Date(review.created_at).getTime())
      .filter((at) => Number.isFinite(at) && at >= started);
    return decisions.length ? [Math.min(...decisions) - started] : [];
  });
  const labels = Object.fromEntries(["true_positive", "false_positive", "false_negative", "true_negative", "unsure"]
    .map((label) => [label, (feedback ?? []).filter((item) => item.label === label).length]));
  const tp = labels.true_positive ?? 0;
  const fp = labels.false_positive ?? 0;
  const fn = labels.false_negative ?? 0;
  const byCategory = (feedback ?? []).reduce<Record<string, number>>((counts, item) => {
    const key = item.category ?? "uncategorized";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const byMediaType = (screens ?? []).reduce<Record<string, number>>((counts, screen) => {
    const capture = Array.isArray(screen.captures) ? screen.captures[0] : screen.captures;
    const key = capture?.media_type ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const providerUsage = (screens ?? []).reduce<Record<string, number>>((totals, screen) => {
    for (const [key, value] of Object.entries(screen.provider_usage ?? {})) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) totals[key] = (totals[key] ?? 0) + numeric;
    }
    return totals;
  }, {});
  return json({
    sampleSize: screens?.length ?? 0,
    p50ProcessingTimeMs: percentile(times, 0.5),
    p95ProcessingTimeMs: percentile(times, 0.95),
    p50ReviewerDecisionTimeMs: percentile(reviewerDecisionTimes, 0.5),
    p95ReviewerDecisionTimeMs: percentile(reviewerDecisionTimes, 0.95),
    failureRate: screens?.length ? screens.filter((screen) => screen.status === "screening_failed").length / screens.length : null,
    estimatedCostUsd: (screens ?? []).reduce((sum, screen) => sum + Number(screen.estimated_cost_usd ?? 0), 0),
    providerUsage,
    feedback: labels,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    byCategory,
    byMediaType,
  });
}
