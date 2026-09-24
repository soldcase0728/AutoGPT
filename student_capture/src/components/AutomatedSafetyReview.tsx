"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SAFETY_CATEGORY_LABELS, type SafetyCategory } from "@/lib/safety/categories";
import type { CaptureSafetyReview, SafetyFinding } from "@/lib/types";

function timecode(milliseconds: number) {
  const total = Math.floor(milliseconds / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
}

/** The scanner runs every minute, so a normal scan is done within a couple. */
function scanTiming(timing: ScanTiming | undefined, now: number): string {
  if (!timing) return "The scan starts within a minute or two of upload.";
  const waited = minutesSince(timing.createdAt, now);
  if (waited >= 10) {
    return `Queued ${waited} minutes ago, which is longer than usual. If this doesn't clear, ask your admin to check the safety scanner is running.`;
  }
  return timing.startedAt
    ? "Scanning now. Usually done within a minute."
    : `Queued ${waited ? `${waited} min ago` : "just now"}. Usually done within 2 minutes.`;
}

export interface ScanTiming {
  createdAt: string;
  startedAt: string | null;
}

function FindingCard({ captureId, finding, mediaIndex, onSeek }: {
  captureId: string; finding: SafetyFinding; mediaIndex: number;
  onSeek?: (seconds: number) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flagged, setFlagged] = useState(false);

  async function post(path: string, body: object) {
    const response = await fetch(`/api/reviews/${captureId}/safety/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "" }));
      throw new Error(payload.error || "That didn't save.");
    }
  }

  /** Not an issue: clears the hold, and tells the scanner it was wrong. */
  async function fine() {
    setBusy(true);
    setError("");
    try {
      await post("resolve", {
        findingId: finding.id,
        resolution: "false_positive",
        reason: reason.trim() || "Reviewer checked the media: this is fine.",
      });
      void post("feedback", {
        screenId: finding.safety_screen_id, findingId: finding.id,
        label: "false_positive", category: finding.category, note: reason.trim() || undefined,
      }).catch(() => undefined);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** A real issue: the hold stays, so it can't be posted; the reviewer asks for a reshoot or rejects. */
  async function problem() {
    setBusy(true);
    setError("");
    try {
      await post("feedback", {
        screenId: finding.safety_screen_id, findingId: finding.id,
        label: "true_positive", category: finding.category, note: reason.trim() || undefined,
      });
      setFlagged(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  const label = SAFETY_CATEGORY_LABELS[finding.category as SafetyCategory] ?? finding.category.replaceAll("_", " ");
  const where = finding.start_ms != null ? `at ${timecode(finding.start_ms)}` : `in photo ${mediaIndex + 1}`;
  return (
    <article className="rounded-sm border p-3" style={{ borderColor: finding.severity === "high" ? "var(--clay)" : "var(--rule)" }}>
      <p className="text-sm font-semibold">
        {label} {where}
        <span className="ml-2 font-normal" style={{ color: "var(--muted)" }}>
          {finding.severity === "high" ? "Likely" : finding.severity === "medium" ? "Possible" : "Unlikely"}
        </span>
      </p>
      <p className="mt-1 text-sm">{finding.description}</p>
      {finding.start_ms != null && onSeek && (
        <button className="mt-2 text-sm underline" onClick={() => onSeek(finding.start_ms! / 1000)}>
          Jump to {timecode(finding.start_ms)}
        </button>
      )}
      {finding.resolution_status === "unreviewed" ? (
        flagged ? (
          <p className="mt-2 text-sm" style={{ color: "var(--clay)" }}>
            Noted as a problem. It can&rsquo;t be posted: ask for a reshoot or reject it below.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} className="btn btn-quiet text-sm" onClick={() => void fine()}>This is fine</button>
              <button disabled={busy} className="btn btn-quiet text-sm" style={{ color: "var(--clay)" }} onClick={() => void problem()}>This is a problem</button>
            </div>
            <input className="rounded-sm border bg-transparent px-3 py-2 text-sm" value={reason}
              onChange={(event) => setReason(event.target.value)} placeholder="Why? (optional)" aria-label="Why? (optional)" />
            {error && <p className="text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
          </div>
        )
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Checked: {finding.resolution_status === "false_positive" ? "fine" : finding.resolution_status.replaceAll("_", " ")}
          {finding.resolution_reason ? `. ${finding.resolution_reason}` : ""}
        </p>
      )}
    </article>
  );
}

export function AutomatedSafetyReview({ captureId, review, timing, mediaIds, onSeek }: {
  captureId: string; review?: CaptureSafetyReview; timing?: ScanTiming; mediaIds: string[];
  onSeek?: (seconds: number) => void;
}) {
  const router = useRouter();
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const [missedOpen, setMissedOpen] = useState(false);
  const [missedCategory, setMissedCategory] = useState<SafetyCategory>("profanity_text");
  const [missedNote, setMissedNote] = useState("");
  const [missedSent, setMissedSent] = useState(false);

  if (!review || review.safety_status === "pending" || review.safety_status === "processing") {
    return (
      <section className="mt-4 rounded-sm border p-4" style={{ borderColor: "var(--rule)" }}>
        <p className="label">Automatic safety check</p>
        <p className="mt-2 text-sm font-semibold">Not finished yet. It can&rsquo;t be posted until it is.</p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{scanTiming(timing, now)}</p>
      </section>
    );
  }
  const currentReview = review;
  const open = review.unresolved_finding_count;
  const headline: Record<string, string> = {
    no_flags: "Nothing found.",
    flags_detected: open
      ? `${open} thing${open === 1 ? "" : "s"} to check before this can be posted.`
      : "Everything it found has been checked.",
    screening_failed: "The check couldn't run on this file.",
    cancelled: "Check stopped (withdrawn or taken down).",
    superseded: "Replaced by the student's newer upload.",
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

  async function reportMissed() {
    if (!missedNote.trim()) return;
    setBusy(true);
    const response = await fetch(`/api/reviews/${captureId}/safety/feedback`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ screenId: currentReview.safety_screen_id, label: "false_negative",
        category: missedCategory, note: missedNote.trim() }),
    });
    setBusy(false);
    if (response.ok) {
      setMissedSent(true);
      setMissedOpen(false);
      setMissedNote("");
    }
  }

  return (
    <section className="mt-4 rounded-sm border p-4" style={{ borderColor: open ? "var(--clay)" : "var(--rule)" }}>
      <p className="label">Automatic safety check</p>
      <p className="mt-2 text-sm font-semibold" style={{ color: open ? "var(--clay)" : review.safety_status === "no_flags" ? "var(--moss)" : undefined }}>
        {headline[review.safety_status] ?? review.safety_status}
      </p>
      {review.findings.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {review.findings.map((finding) => <FindingCard key={finding.id} captureId={captureId}
            finding={finding} mediaIndex={Math.max(0, mediaIds.indexOf(finding.submission_media_id))} onSeek={onSeek} />)}
        </div>
      )}
      {review.safety_status === "screening_failed" && !review.failed_scan_overridden && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">Watch or look through it yourself. If it&rsquo;s fine, say so and it can be posted.</p>
          <input className="rounded-sm border bg-transparent px-3 py-2 text-sm" value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)} placeholder="What you checked" aria-label="What you checked" />
          <button className="btn btn-quiet text-sm" disabled={busy || !overrideReason.trim()} onClick={() => void override()}>
            I checked it myself: it&rsquo;s fine
          </button>
        </div>
      )}
      {review.failed_scan_overridden && <p className="mt-3 text-sm">Checked by hand and cleared.</p>}
      {(review.safety_status === "no_flags" || review.safety_status === "flags_detected") && (
        missedSent ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>Thanks. That helps the check improve.</p>
        ) : missedOpen ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <select className="rounded-sm border bg-transparent px-2 py-2 text-sm" value={missedCategory}
              aria-label="What it missed"
              onChange={(event) => setMissedCategory(event.target.value as SafetyCategory)}>
              {Object.entries(SAFETY_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className="rounded-sm border bg-transparent px-3 py-2 text-sm" value={missedNote}
              onChange={(event) => setMissedNote(event.target.value)} placeholder="What and where" aria-label="What and where" />
            <button className="btn btn-quiet text-sm" disabled={busy || !missedNote.trim()} onClick={() => void reportMissed()}>
              Send
            </button>
          </div>
        ) : (
          <button className="mt-3 text-sm underline" style={{ color: "var(--muted)" }} onClick={() => setMissedOpen(true)}>
            The check missed something
          </button>
        )
      )}
    </section>
  );
}
