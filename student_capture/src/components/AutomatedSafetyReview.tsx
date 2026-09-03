"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SAFETY_CATEGORY_LABELS, type SafetyCategory } from "@/lib/safety/categories";
import type { CaptureSafetyReview, SafetyFinding, SafetyResolution } from "@/lib/types";

function timecode(milliseconds: number) {
  const total = Math.floor(milliseconds / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function FindingCard({ captureId, finding, mediaIndex, onSeek }: {
  captureId: string; finding: SafetyFinding; mediaIndex: number;
  onSeek?: (seconds: number) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(resolution: SafetyResolution) {
    if (resolution === "unreviewed" || !reason.trim()) return;
    setBusy(true);
    const response = await fetch(`/api/reviews/${captureId}/safety/resolve`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ findingId: finding.id, resolution, reason: reason.trim() }),
    });
    setBusy(false);
    if (response.ok) router.refresh();
  }

  async function feedback(label: "true_positive" | "false_positive" | "unsure") {
    setBusy(true);
    const response = await fetch(`/api/reviews/${captureId}/safety/feedback`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ screenId: finding.safety_screen_id, findingId: finding.id,
        label, category: finding.category, note: reason.trim() || undefined }),
    });
    setBusy(false);
    if (response.ok) router.refresh();
  }

  const label = SAFETY_CATEGORY_LABELS[finding.category as SafetyCategory] ?? finding.category.replaceAll("_", " ");
  return (
    <article className="rounded-sm border p-3" style={{ borderColor: finding.severity === "high" ? "var(--clay)" : "var(--rule)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">{finding.severity} · {label}</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          Photo {mediaIndex + 1}{finding.start_ms != null ? ` · ${timecode(finding.start_ms)}` : ""}
          {` · ${Math.round(finding.confidence * 100)}%`}
        </span>
      </div>
      <p className="mt-2 text-sm">{finding.description}</p>
      {finding.start_ms != null && onSeek && (
        <button className="mt-2 text-sm underline" onClick={() => onSeek(finding.start_ms! / 1000)}>
          View video at {timecode(finding.start_ms)}
        </button>
      )}
      {finding.resolution_status === "unreviewed" ? (
        <div className="mt-3 flex flex-col gap-2">
          <input className="rounded-sm border bg-transparent px-3 py-2 text-sm" value={reason}
            onChange={(event) => setReason(event.target.value)} placeholder="Required resolution or feedback note" />
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !reason.trim()} className="btn btn-quiet text-sm" onClick={() => void act("accepted_context")}>Accept context</button>
            <button disabled={busy || !reason.trim()} className="btn btn-quiet text-sm" onClick={() => void act("false_positive")}>Resolve false positive</button>
            <button disabled={busy || !reason.trim()} className="btn btn-quiet text-sm" onClick={() => void act("addressed")}>Mark addressed</button>
            <button disabled={busy} className="text-sm underline" onClick={() => void feedback("true_positive")}>TP</button>
            <button disabled={busy} className="text-sm underline" onClick={() => void feedback("false_positive")}>FP</button>
            <button disabled={busy} className="text-sm underline" onClick={() => void feedback("unsure")}>Unsure</button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Resolved: {finding.resolution_status.replaceAll("_", " ")} — {finding.resolution_reason}
        </p>
      )}
    </article>
  );
}

export function AutomatedSafetyReview({ captureId, review, mediaIds, onSeek }: {
  captureId: string; review?: CaptureSafetyReview; mediaIds: string[]; onSeek?: (seconds: number) => void;
}) {
  const router = useRouter();
  const [overrideReason, setOverrideReason] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [missedCategory, setMissedCategory] = useState<SafetyCategory>("profanity_text");
  const [busy, setBusy] = useState(false);
  if (!review) return <section className="mt-4 rounded-sm border p-4"><p className="label">Automated safety review</p><p className="mt-2 text-sm">Waiting to start.</p></section>;
  const currentReview = review;
  const statusText: Record<string, string> = {
    pending: "Queued for automated review", processing: "Scanning",
    no_flags: "No automated risks detected",
    flags_detected: `${review.finding_count} potential issue${review.finding_count === 1 ? "" : "s"} detected`,
    screening_failed: "Automated review unavailable", cancelled: "Automated review cancelled",
    superseded: "Superseded by newer media",
  };
  async function override() {
    if (!overrideReason.trim()) return;
    setBusy(true);
    const response = await fetch(`/api/reviews/${captureId}/safety/override`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ screenId: currentReview.safety_screen_id, reason: overrideReason.trim() }),
    });
    setBusy(false);
    if (response.ok) router.refresh();
  }
  async function screenFeedback(label: "false_negative" | "true_negative" | "unsure") {
    if (label === "false_negative" && !feedbackNote.trim()) return;
    setBusy(true);
    const response = await fetch(`/api/reviews/${captureId}/safety/feedback`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ screenId: currentReview.safety_screen_id, label,
        category: label === "false_negative" ? missedCategory : undefined,
        note: feedbackNote.trim() || undefined }),
    });
    setBusy(false);
    if (response.ok) { setFeedbackNote(""); router.refresh(); }
  }
  return (
    <section className="mt-4 rounded-sm border p-4" style={{ borderColor: review.unresolved_finding_count ? "var(--clay)" : "var(--rule)" }}>
      <p className="label">Automated safety review</p>
      <p className="mt-2 font-semibold">{statusText[review.safety_status]}</p>
      <div className="mt-3 flex flex-col gap-3">
        {review.findings.map((finding) => <FindingCard key={finding.id} captureId={captureId}
          finding={finding} mediaIndex={Math.max(0, mediaIds.indexOf(finding.submission_media_id))} onSeek={onSeek} />)}
      </div>
      {review.safety_status === "screening_failed" && !review.failed_scan_overridden && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">A manual visual review is required before overriding this failed scan.</p>
          <input className="rounded-sm border bg-transparent px-3 py-2 text-sm" value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)} placeholder="Required override reason" />
          <button className="btn btn-quiet text-sm" disabled={busy || !overrideReason.trim()} onClick={() => void override()}>
            Record manual-review override
          </button>
        </div>
      )}
      {review.failed_scan_overridden && <p className="mt-3 text-sm">Failed scan manually reviewed and overridden.</p>}
      {review.safety_status === "no_flags" && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--rule)" }}>
          <p className="text-sm font-semibold">Was the automated result correct?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-quiet text-sm" disabled={busy} onClick={() => void screenFeedback("true_negative")}>Correct — no issue</button>
            <button className="btn btn-quiet text-sm" disabled={busy} onClick={() => void screenFeedback("unsure")}>Unsure</button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <select className="rounded-sm border bg-transparent px-2 py-2 text-sm" value={missedCategory}
              onChange={(event) => setMissedCategory(event.target.value as SafetyCategory)}>
              {Object.entries(SAFETY_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className="rounded-sm border bg-transparent px-3 py-2 text-sm" value={feedbackNote}
              onChange={(event) => setFeedbackNote(event.target.value)} placeholder="Describe the issue the scan missed" />
            <button className="btn btn-quiet text-sm" disabled={busy || !feedbackNote.trim()}
              onClick={() => void screenFeedback("false_negative")}>Add missed issue</button>
          </div>
        </div>
      )}
    </section>
  );
}
