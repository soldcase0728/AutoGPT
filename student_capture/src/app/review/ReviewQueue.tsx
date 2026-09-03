"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";
import { describeBlocker, publishable } from "@/lib/consent";
import { formatBytes } from "@/lib/format-spec";
import { AutomatedSafetyReview } from "@/components/AutomatedSafetyReview";
import type { CaptureSafetyReview, CaptureState, QueueRow } from "@/lib/types";

type Decision = Extract<
  CaptureState,
  "approved" | "changes_requested" | "rejected" | "published"
>;

const KEYS: Record<string, Decision> = {
  a: "approved",
  r: "changes_requested",
  x: "rejected",
  p: "published",
};

export function ReviewQueue({
  rows,
  withdrawals = [],
  safetyReviews = [],
  filter,
  /**
   * Plays this file for every row instead of each capture's own signed URL.
   * Only for previews and tests — a plain string, because props crossing the
   * server/client boundary have to serialise.
   */
  mediaSrc,
}: {
  rows: QueueRow[];
  withdrawals?: WithdrawalRow[];
  safetyReviews?: CaptureSafetyReview[];
  filter: string;
  mediaSrc?: string;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [takingDown, setTakingDown] = useState(false);
  const [opening, setOpening] = useState(false);
  const openedRef = useRef(new Set<string>());
  const videoRef = useRef<HTMLVideoElement>(null);

  const current = rows[Math.min(index, rows.length - 1)];
  const currentSafety = current
    ? safetyReviews.find((review) => review.capture_id === current.id)
    : undefined;

  useEffect(() => {
    if (!current || current.state !== "submitted" || opening || openedRef.current.has(current.id)) return;
    openedRef.current.add(current.id);
    setOpening(true);
    setError("");
    void fetch(`/api/reviews/${current.id}/open`, { method: "POST" }).then(async (response) => {
      setOpening(false);
      if (!response.ok) {
        openedRef.current.delete(current.id);
        const body = await response.json().catch(() => ({ error: "Could not open this review." }));
        setError(body.error ?? "Could not open this review.");
        return;
      }
      router.refresh();
    });
  }, [current, opening, router]);

  const decide = useCallback(
    async (decision: Decision) => {
      if (!current || busy || opening || current.state === "submitted") return;
      const allowed =
        (decision === "published" && current.state === "approved") ||
        (decision === "changes_requested" && current.state === "in_review") ||
        (["approved", "rejected"].includes(decision) &&
          ["in_review", "changes_requested"].includes(current.state));
      if (!allowed) return;
      if (decision === "changes_requested" && !note.trim()) {
        setError("Say what needs changing — the student only sees the note.");
        return;
      }
      setBusy(true);
      setError("");

      const response = await fetch(`/api/reviews/${current.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      });

      setBusy(false);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "That did not save." }));
        setError(body.error ?? "That did not save.");
        return;
      }

      setNote("");
      setIndex((i) => Math.min(i + 1, Math.max(rows.length - 2, 0)));
      router.refresh();
    },
    [busy, current, note, opening, rows.length, router],
  );

  // Reviewing is a two-hand job: one on the keyboard, one on the coffee.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "j") {
        setIndex((i) => Math.min(i + 1, rows.length - 1));
      } else if (key === "k") {
        setIndex((i) => Math.max(i - 1, 0));
      } else if (KEYS[key]) {
        event.preventDefault();
        void decide(KEYS[key] as Decision);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, rows.length]);

  if (rows.length === 0 && withdrawals.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg font-semibold">Queue is clear</p>
        <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
          Nothing waiting in <span className="font-mono">{filter}</span>.
        </p>
      </div>
    );
  }

  const blockers = current?.consent_blockers ?? [];
  const safetyCleared = currentSafety?.safety_status === "no_flags"
    || (currentSafety?.safety_status === "flags_detected" && currentSafety.unresolved_finding_count === 0)
    || (currentSafety?.safety_status === "screening_failed" && currentSafety.failed_scan_overridden);
  const canPublish = publishable(blockers) && Boolean(safetyCleared)
    && current?.student_participation === "active";

  return (
    <div className="flex flex-col gap-6">
      {withdrawals.length > 0 && (
        <WithdrawalInbox rows={withdrawals} onSaved={() => router.refresh()} />
      )}
      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold">Review queue is clear</p>
          <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
            The withdrawal requests above are the only items needing action.
          </p>
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* the queue */}
      <aside className="flex max-h-[78vh] flex-col gap-2 overflow-y-auto pr-1">
        <div className="flex items-center justify-between">
          <p className="label">
            {rows.length} waiting · {index + 1} of {rows.length}
          </p>
          <a href="/api/review/export?format=txt" className="label underline underline-offset-4">
            Export
          </a>
        </div>
        {rows.map((row, i) => {
          const rowSafety = safetyReviews.find((review) => review.capture_id === row.id);
          const rowSafetyReady = rowSafety?.safety_status === "no_flags"
            || (rowSafety?.safety_status === "flags_detected" && rowSafety.unresolved_finding_count === 0)
            || (rowSafety?.safety_status === "screening_failed" && rowSafety.failed_scan_overridden);
          return <button
            key={row.id}
            onClick={() => setIndex(i)}
            className="card p-3 text-left"
            style={{
              borderColor: i === index ? "var(--ink)" : "var(--rule)",
              background: i === index ? "var(--sunk)" : "var(--surface)",
            }}
          >
            <p className="text-sm font-semibold">{row.student}</p>
            <p className="mt-0.5 truncate text-sm" style={{ color: "var(--muted)" }}>
              {row.one_liner || row.idea_title}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip>{row.state.replace("_", " ")}</Chip>
              {row.consent_blockers?.length > 0 && <Chip tone="bad">held</Chip>}
              {row.student_participation !== "active" && <Chip tone="bad">account {row.student_participation}</Chip>}
              {rowSafety?.unresolved_finding_count ? (
                <Chip tone="bad">safety hold</Chip>
              ) : row.state === "approved" && rowSafetyReady && !(row.consent_blockers?.length) ? (
                <Chip tone="good">ready to post</Chip>
              ) : row.state === "approved" && !rowSafetyReady ? <Chip>safety pending</Chip> : null}
            </div>
          </button>
        })}
      </aside>

      {/* the capture */}
      {current && (
        <section className="flex flex-col gap-4">
          {/* Vertical clips are the norm, and a 9:16 frame stretched across a
              desktop panel is mostly black bars. Hold portrait media to a
              sensible column instead. */}
          <div
            className="card overflow-hidden"
            style={
              (current.height ?? 1) >= (current.width ?? 0)
                ? { maxWidth: "26rem", marginInline: "auto", width: "100%" }
                : undefined
            }
          >
            {current.media_type !== "video" ? (
              <div className={(current.media_items?.length ?? 0) > 1 ? "grid gap-2 sm:grid-cols-2" : ""}>
                {(current.media_items?.length ? current.media_items : [{ id: "primary", width: null, height: null }]).map(
                  (media, mediaIndex) => (
                    <div key={media.id} className="relative overflow-hidden bg-black"
                      style={media.width && media.height ? { aspectRatio: `${media.width}/${media.height}` } : undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mediaSrc ?? `/api/captures/${current.id}/media${media.id === "primary" ? "" : `?mediaId=${media.id}`}`}
                        alt={`${current.one_liner ?? current.idea_title} — photo ${mediaIndex + 1}`}
                        className="h-full max-h-[60vh] w-full object-contain" />
                      {currentSafety?.findings.filter((finding) => finding.submission_media_id === media.id && finding.bounding_box).map((finding) => (
                        <span key={finding.id} className="pointer-events-none absolute border-2"
                          style={{ borderColor: "var(--clay)", left: `${finding.bounding_box!.x * 100}%`,
                            top: `${finding.bounding_box!.y * 100}%`, width: `${finding.bounding_box!.width * 100}%`,
                            height: `${finding.bounding_box!.height * 100}%` }} />
                      ))}
                    </div>
                  ),
                )}
              </div>
            ) : (
              <video
                ref={videoRef}
                key={current.id}
                src={mediaSrc ?? `/api/captures/${current.id}/media`}
                controls
                playsInline
                preload="metadata"
                className="max-h-[60vh] w-full bg-black"
              />
            )}
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="accent">{current.campaign_name}</Chip>
              <Chip>{current.idea_title}</Chip>
              <Chip>{current.media_type.replace("_", " ")}</Chip>
              {current.orientation && <Chip>{current.orientation}</Chip>}
              {(current.media_items?.length ?? 0) > 1 && <Chip>{current.media_items.length} photos</Chip>}
              {current.duration_s && <Chip>{Math.round(current.duration_s)}s</Chip>}
              {current.width && current.height && (
                <Chip>
                  {current.width}×{current.height}
                </Chip>
              )}
              {current.master_bytes && <Chip>{formatBytes(current.master_bytes)}</Chip>}
              {current.student_participation !== "active" && <Chip tone="bad">account {current.student_participation}</Chip>}
              {current.state === "approved" && canPublish && <Chip tone="good">ready to post</Chip>}
              {current.state === "approved" && !canPublish && <Chip tone="bad">not ready to post</Chip>}
              {!current.exif_stripped && <Chip>location not stripped</Chip>}
            </div>

            <p className="mt-3 text-lg font-semibold">
              {current.one_liner ?? <span style={{ color: "var(--muted)" }}>No caption given</span>}
            </p>
            <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
              {current.student}
              {current.location_label ? ` · ${current.location_label}` : ""}
              {current.submitted_at
                ? ` · ${new Date(current.submitted_at).toLocaleString()}`
                : ""}
            </p>

            {blockers.length > 0 ? (
              <div
                className="mt-4 rounded-sm border p-3"
                style={{ borderColor: "var(--clay)" }}
              >
                <p className="label" style={{ color: "var(--clay)" }}>
                  Cannot be published yet
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-[15px]">
                  {blockers.map((b, i) => (
                    <li key={i}>{describeBlocker(b)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 text-[15px]" style={{ color: "var(--moss)" }}>
                Everyone in frame is cleared.
              </p>
            )}

            <AutomatedSafetyReview captureId={current.id} review={currentSafety}
              mediaIds={(current.media_items?.length ? current.media_items : [{ id: "primary" }]).map((media) => media.id)}
              onSeek={(seconds) => { if (videoRef.current) { videoRef.current.currentTime = seconds; void videoRef.current.play(); } }} />

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Note back to the student (required to ask for changes)"
              className="card mt-4 w-full px-3 py-2"
              style={{ background: "var(--bg)" }}
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn" disabled={busy || opening || !["in_review", "changes_requested"].includes(current.state)} onClick={() => decide("approved")}>
                Approve <kbd className="ml-1 font-mono text-xs opacity-60">A</kbd>
              </button>
              <button
                className="btn btn-quiet"
                disabled={busy || opening || current.state !== "in_review"}
                onClick={() => decide("changes_requested")}
              >
                Ask for changes <kbd className="ml-1 font-mono text-xs opacity-60">R</kbd>
              </button>
              <button className="btn btn-quiet" disabled={busy || opening || !["in_review", "changes_requested"].includes(current.state)} onClick={() => decide("rejected")}>
                Reject <kbd className="ml-1 font-mono text-xs opacity-60">X</kbd>
              </button>
              <button
                className="btn btn-quiet"
                disabled={busy || opening || !canPublish || current.state !== "approved"}
                title={canPublish ? undefined : "Blocked until consent and automated safety review are clear"}
                onClick={() => decide("published")}
              >
                Mark posted <kbd className="ml-1 font-mono text-xs opacity-60">P</kbd>
              </button>
              <a
                className="btn btn-quiet"
                href={`/api/captures/${current.id}/media?disposition=attachment`}
              >
                Download master
              </a>
              {(current.state === "published" || current.state === "approved") && (
                <button
                  className="btn btn-quiet"
                  disabled={busy || takingDown}
                  style={{ borderColor: "var(--clay)", color: "var(--clay)" }}
                  onClick={async () => {
                    const reason = note.trim();
                    if (!reason) {
                      setError(
                        "Put the reason in the note first — it goes in the permanent record.",
                      );
                      return;
                    }
                    setTakingDown(true);
                    setError("");
                    const response = await fetch(`/api/captures/${current.id}/takedown`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ reason }),
                    });
                    setTakingDown(false);
                    if (!response.ok) {
                      const body = await response
                        .json()
                        .catch(() => ({ error: "That did not save." }));
                      setError(body.error ?? "That did not save.");
                      return;
                    }
                    setNote("");
                    router.refresh();
                  }}
                >
                  {takingDown ? "Taking down…" : "Take down"}
                </button>
              )}
            </div>

            {error && (
              <p className="mt-3 text-sm" style={{ color: "var(--clay)" }}>
                {error}
              </p>
            )}
            <p className="label mt-4">J / K to move · A R X P to decide</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Nothing here has been posted. Every item needs a person to release it.
            </p>
          </div>
        </section>
      )}
      </div>
      )}
    </div>
  );
}

export interface WithdrawalRow {
  id: string;
  captureId: string;
  student: string;
  ideaTitle: string;
  reason: string | null;
  requestedAt: string;
}

function WithdrawalInbox({ rows, onSaved }: { rows: WithdrawalRow[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(row: WithdrawalRow, decision: "approved" | "denied") {
    const reason = decision === "denied"
      ? window.prompt("Why can this not be withdrawn yet? This is shown to the student.", "")
      : "";
    if (reason === null || (decision === "denied" && !reason.trim())) return;
    setBusy(row.id);
    setError("");
    const response = await fetch(`/api/withdrawals/${row.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason: reason || undefined }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "That did not save." }));
      setError(body.error ?? "That did not save.");
      return;
    }
    onSaved();
  }

  return (
    <section className="card p-5" style={{ borderColor: "var(--clay)" }}>
      <p className="label" style={{ color: "var(--clay)" }}>Withdrawal requests · {rows.length}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: "var(--rule)" }}>
            <p className="font-semibold">{row.student} · {row.ideaTitle}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {row.reason || "No reason given."} · {new Date(row.requestedAt).toLocaleString()}
            </p>
            <div className="mt-2 flex gap-2">
              <button className="btn" disabled={busy === row.id} onClick={() => void decide(row, "approved")}>Approve withdrawal</button>
              <button className="btn btn-quiet" disabled={busy === row.id} onClick={() => void decide(row, "denied")}>Keep in workflow</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
    </section>
  );
}
