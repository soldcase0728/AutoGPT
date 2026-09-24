"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";
import { describeBlocker, publishable } from "@/lib/consent";
import { formatBytes } from "@/lib/format-spec";
import { AutomatedSafetyReview, type ScanTiming } from "@/components/AutomatedSafetyReview";
import { MESSAGE_PRESETS, QUEUE_TABS, nextSelection, type QueueTabId } from "@/lib/queue";
import type { CaptureSafetyReview, CaptureState, QueueRow } from "@/lib/types";

type Decision = Extract<CaptureState, "approved" | "changes_requested" | "rejected" | "published">;

const KEYS: Record<string, Decision> = {
  a: "approved",
  r: "changes_requested",
  x: "rejected",
  p: "published",
};

const STATE_LABEL: Record<string, string> = {
  submitted: "new",
  in_review: "in review",
  changes_requested: "reshoot asked",
  approved: "approved",
  published: "posted",
  rejected: "rejected",
};

export interface CaptureExtras {
  tagged: Array<{ personId: string; name: string }>;
  messages: Array<{ state: string; note: string; at: string }>;
  internalNotes: Array<{ note: string; at: string; author: string }>;
  openedBy: string | null;
  postUrl: string | null;
  scanTiming?: ScanTiming;
}

export interface WithdrawalRow {
  id: string;
  captureId: string;
  student: string;
  ideaTitle: string;
  reason: string | null;
  requestedAt: string;
}

export interface SafetyReportRow {
  id: string;
  kind: string;
  detail: string;
  createdAt: string;
  reporter: string;
  ideaTitle: string | null;
}

function safetyCleared(review?: CaptureSafetyReview) {
  return review?.safety_status === "no_flags"
    || (review?.safety_status === "flags_detected" && review.unresolved_finding_count === 0)
    || (review?.safety_status === "screening_failed" && review.failed_scan_overridden);
}

function queueHref(tab: QueueTabId, search: string, taskId?: string | null) {
  const params = new URLSearchParams({ tab });
  if (search) params.set("q", search);
  if (taskId) params.set("task", taskId);
  return `/review?${params.toString()}`;
}

export function ReviewQueue({
  rows,
  tab,
  counts,
  search,
  task = null,
  extras = {},
  withdrawals = [],
  safetyReports = [],
  safetyReviews = [],
  /**
   * Plays this file for every row instead of each capture's own signed URL.
   * Only for previews and tests — a plain string, because props crossing the
   * server/client boundary have to serialise.
   */
  mediaSrc,
}: {
  rows: QueueRow[];
  tab: QueueTabId;
  counts: Record<QueueTabId, number>;
  search: string;
  task?: { id: string; title: string } | null;
  extras?: Record<string, CaptureExtras>;
  withdrawals?: WithdrawalRow[];
  safetyReports?: SafetyReportRow[];
  safetyReviews?: CaptureSafetyReview[];
  mediaSrc?: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [linkSaved, setLinkSaved] = useState("");
  const [takingDown, setTakingDown] = useState(false);
  const [takedownReason, setTakedownReason] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  const current = rows.find((row) => row.id === selectedId) ?? rows[0];
  const currentExtras = current ? extras[current.id] : undefined;
  const currentSafety = current
    ? safetyReviews.find((review) => review.capture_id === current.id)
    : undefined;

  // Fresh fields for each item.
  useEffect(() => {
    setMessage("");
    setInternalNote("");
    setPostUrl(current ? (extras[current.id]?.postUrl ?? "") : "");
    setLinkSaved("");
    setTakingDown(false);
    setTakedownReason("");
    setError("");
  }, [current, extras]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  const decide = useCallback(
    async (decision: Decision) => {
      if (!current || busy) return;
      // Opening happens on the first decision, not on viewing: browsing the
      // queue does not tell the student "Being reviewed".
      const state = current.state === "submitted" ? "in_review" : current.state;
      const allowed =
        (decision === "published" && state === "approved") ||
        (decision === "changes_requested" && state === "in_review") ||
        (["approved", "rejected"].includes(decision) &&
          ["in_review", "changes_requested"].includes(state));
      if (!allowed) return;
      if ((decision === "changes_requested" || decision === "rejected") && !message.trim()) {
        setError(
          decision === "rejected"
            ? "Write the student a message saying why it wasn't accepted. Tap a reason below to start."
            : "Write the student a message saying what to change. Tap a reason below to start.",
        );
        return;
      }
      setBusy(true);
      setError("");

      if (current.state === "submitted") {
        const opened = await fetch(`/api/reviews/${current.id}/open`, { method: "POST" });
        if (!opened.ok) {
          const body = await opened.json().catch(() => ({ error: "" }));
          setBusy(false);
          setError(body.error || "Couldn't open this for review. Refresh and try again.");
          return;
        }
      }

      const response = await fetch(`/api/reviews/${current.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          note: message.trim() || undefined,
          internalNote: internalNote.trim() || undefined,
        }),
      });

      if (!response.ok) {
        setBusy(false);
        const body = await response.json().catch(() => ({ error: "" }));
        setError(body.error || "That didn't save.");
        return;
      }

      if (decision === "published" && postUrl.trim()) {
        const linked = await fetch(`/api/captures/${current.id}/post-link`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: postUrl.trim() }),
        });
        if (!linked.ok) {
          const body = await linked.json().catch(() => ({ error: "" }));
          setError(`Marked posted, but the link didn't save: ${body.error || "add it from the Posted tab."}`);
        }
      }

      setBusy(false);
      select(nextSelection(rows.map((row) => row.id), current.id));
      router.refresh();
    },
    [busy, current, internalNote, message, postUrl, router, rows, select],
  );

  async function saveLink() {
    if (!current) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/captures/${current.id}/post-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: postUrl.trim() }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "" }));
      setError(body.error || "The link didn't save.");
      return;
    }
    setLinkSaved(postUrl.trim() ? "Saved. The student can see it now." : "Link removed.");
    router.refresh();
  }

  async function takeDown() {
    if (!current) return;
    if (!message.trim() || !takedownReason.trim()) {
      setError("A takedown needs both a message to the student and the reason for the staff record.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/captures/${current.id}/takedown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: takedownReason.trim(), message: message.trim() }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "" }));
      setError(body.error || "That didn't save.");
      return;
    }
    select(nextSelection(rows.map((row) => row.id), current.id));
    router.refresh();
  }

  // Reviewing is a two-hand job: one on the keyboard, one on the coffee.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!current) return;

      const key = event.key.toLowerCase();
      const index = rows.findIndex((row) => row.id === current.id);
      if (key === "j") {
        select(rows[Math.min(index + 1, rows.length - 1)]?.id ?? null);
      } else if (key === "k") {
        select(rows[Math.max(index - 1, 0)]?.id ?? null);
      } else if (KEYS[key]) {
        event.preventDefault();
        void decide(KEYS[key] as Decision);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, decide, rows, select]);

  const activeTab = QUEUE_TABS.find((t) => t.id === tab)!;
  const blockers = current?.consent_blockers ?? [];
  const cleared = safetyCleared(currentSafety);
  const postBlockers: string[] = current
    ? [
        ...blockers.map((b) => `Consent: ${describeBlocker(b)}`),
        ...(cleared
          ? []
          : [
              currentSafety?.unresolved_finding_count
                ? `Safety check: ${currentSafety.unresolved_finding_count} thing${currentSafety.unresolved_finding_count === 1 ? "" : "s"} to check above.`
                : currentSafety?.safety_status === "screening_failed"
                  ? "Safety check: couldn't run. Check it yourself above."
                  : "Safety check: not finished yet.",
            ]),
        ...(current.student_participation !== "active"
          ? [`The student's account is ${current.student_participation}.`]
          : []),
      ]
    : [];
  const canPublish = postBlockers.length === 0;
  const state = current?.state === "submitted" ? "in_review" : current?.state;
  const canJudge = state === "in_review" || state === "changes_requested";

  return (
    <div className="flex flex-col gap-5">
      {/* tabs, search, filter */}
      <div className="flex flex-col gap-3">
        <nav className="flex flex-wrap gap-2" aria-label="Queue">
          {QUEUE_TABS.map((t) => (
            <Link
              key={t.id}
              href={queueHref(t.id, search, task?.id)}
              aria-current={t.id === tab ? "page" : undefined}
              className="rounded-sm border px-3 py-1.5 text-sm"
              style={{
                borderColor: t.id === tab ? "var(--ink)" : "var(--rule)",
                background: t.id === tab ? "var(--ink)" : "transparent",
                color: t.id === tab ? "var(--bg)" : "var(--ink)",
              }}
            >
              {t.label} <span className="font-mono text-xs opacity-70">{counts[t.id] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-center gap-2" action="/review" method="get">
          <input type="hidden" name="tab" value={tab} />
          {task && <input type="hidden" name="task" value={task.id} />}
          <input
            name="q"
            defaultValue={search}
            placeholder="Search student, task or caption"
            aria-label="Search student, task or caption"
            className="card min-w-0 flex-1 px-3 py-2 text-sm sm:max-w-sm"
            style={{ background: "var(--surface)" }}
          />
          <button className="btn btn-quiet text-sm" type="submit">Search</button>
          {search && (
            <Link className="text-sm underline" href={queueHref(tab, "", task?.id)}>Clear search</Link>
          )}
          {task && (
            <span className="flex items-center gap-2 text-sm">
              <Chip tone="accent">Task: {task.title}</Chip>
              <Link className="underline" href={queueHref(tab, search)}>All tasks</Link>
            </span>
          )}
          <a href="/api/review/export?format=txt" className="label ml-auto underline underline-offset-4">
            Export
          </a>
        </form>
      </div>

      {tab === "review" && safetyReports.length > 0 && (
        <SafetyReportsInbox rows={safetyReports} onSaved={() => router.refresh()} />
      )}
      {tab === "review" && withdrawals.length > 0 && (
        <WithdrawalInbox rows={withdrawals} onSaved={() => router.refresh()} />
      )}

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold">{search ? "No matches" : activeTab.empty}</p>
          {search && (
            <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
              Nothing in {activeTab.label} matches &ldquo;{search}&rdquo;.
            </p>
          )}
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* the list */}
      <aside className="flex max-h-[78vh] flex-col gap-2 overflow-y-auto pr-1">
        <p className="label">
          {rows.length} in {activeTab.label.toLowerCase()}
          {current ? ` · ${rows.findIndex((row) => row.id === current.id) + 1} of ${rows.length}` : ""}
        </p>
        {rows.map((row) => {
          const rowSafety = safetyReviews.find((review) => review.capture_id === row.id);
          const on = row.id === current?.id;
          return <button
            key={row.id}
            onClick={() => select(row.id)}
            className="card p-3 text-left"
            style={{
              borderColor: on ? "var(--ink)" : "var(--rule)",
              background: on ? "var(--sunk)" : "var(--surface)",
            }}
          >
            <p className="text-sm font-semibold">{row.student}</p>
            <p className="mt-0.5 truncate text-sm" style={{ color: "var(--muted)" }}>
              {row.one_liner || row.idea_title}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip>{STATE_LABEL[row.state] ?? row.state}</Chip>
              {row.consent_blockers?.length > 0 && <Chip tone="bad">consent missing</Chip>}
              {row.student_participation !== "active" && <Chip tone="bad">account {row.student_participation}</Chip>}
              {rowSafety?.unresolved_finding_count ? (
                <Chip tone="bad">safety: check</Chip>
              ) : row.state === "approved" && safetyCleared(rowSafety) && !(row.consent_blockers?.length) ? (
                <Chip tone="good">ready to post</Chip>
              ) : row.state === "approved" && !safetyCleared(rowSafety) ? <Chip>safety pending</Chip> : null}
            </div>
          </button>;
        })}
      </aside>

      {/* the capture */}
      {current && (
        <section className="flex flex-col gap-4">
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
                        alt={`${current.one_liner ?? current.idea_title}, photo ${mediaIndex + 1}`}
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
              <Chip>{STATE_LABEL[current.state] ?? current.state}</Chip>
              {current.duration_s && <Chip>{Math.round(current.duration_s)}s</Chip>}
              {current.width && current.height && (
                <Chip>
                  {current.width}×{current.height}
                </Chip>
              )}
              {current.master_bytes && <Chip>{formatBytes(current.master_bytes)}</Chip>}
              {!current.exif_stripped && current.media_type === "video" && <Chip>location not stripped</Chip>}
            </div>

            <p className="mt-3 text-lg font-semibold">
              {current.one_liner ?? <span style={{ color: "var(--muted)" }}>No caption given</span>}
            </p>
            <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
              {current.student}
              {current.location_label ? ` · ${current.location_label}` : ""}
              {current.submitted_at ? ` · sent ${new Date(current.submitted_at).toLocaleString()}` : ""}
              {currentExtras?.openedBy ? ` · opened by ${currentExtras.openedBy}` : ""}
            </p>

            <AskedFor row={current} extras={currentExtras} />

            <AutomatedSafetyReview captureId={current.id} review={currentSafety}
              timing={currentExtras?.scanTiming}
              mediaIds={(current.media_items?.length ? current.media_items : [{ id: "primary" }]).map((media) => media.id)}
              onSeek={(seconds) => { if (videoRef.current) { videoRef.current.currentTime = seconds; void videoRef.current.play(); } }} />

            {(currentExtras?.messages.length || currentExtras?.internalNotes.length) ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer" style={{ color: "var(--muted)" }}>
                  History ({(currentExtras?.messages.length ?? 0) + (currentExtras?.internalNotes.length ?? 0)})
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {currentExtras?.messages.map((m, i) => (
                    <li key={`m${i}`}><span className="font-semibold">To student</span> ({STATE_LABEL[m.state] ?? m.state}, {new Date(m.at).toLocaleDateString()}): {m.note}</li>
                  ))}
                  {currentExtras?.internalNotes.map((n, i) => (
                    <li key={`n${i}`}><span className="font-semibold">Staff note</span> ({n.author}, {new Date(n.at).toLocaleDateString()}): {n.note}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {current.state !== "rejected" && (
              <div className="mt-5 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--rule)" }}>
                <div>
                  <label className="label" htmlFor="student-message">Message to student</label>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    The student reads this as &ldquo;Marketing desk: …&rdquo;. Needed to ask for changes, reject, or take down.
                  </p>
                  <textarea
                    id="student-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                    className="card mt-2 w-full px-3 py-2"
                    style={{ background: "var(--bg)" }}
                  />
                  {canJudge && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {MESSAGE_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="rounded-sm border px-2 py-1 text-xs"
                          style={{ borderColor: "var(--rule)" }}
                          onClick={() => setMessage((m) => (m.trim() ? `${m.trim()} ${preset}` : preset))}
                        >
                          {preset.split(".")[0]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="internal-note">Internal note (staff only)</label>
                  <textarea
                    id="internal-note"
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    rows={1}
                    className="card mt-2 w-full px-3 py-2"
                    style={{ background: "var(--bg)" }}
                    placeholder="Context for the team. Never shown to the student."
                  />
                </div>

                {(current.state === "approved" || current.state === "published") && (
                  <div>
                    <label className="label" htmlFor="post-url">Link to the post</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        id="post-url"
                        type="url"
                        inputMode="url"
                        value={postUrl}
                        onChange={(e) => {
                          setPostUrl(e.target.value);
                          setLinkSaved("");
                        }}
                        placeholder="https://www.instagram.com/p/…"
                        className="card min-w-0 flex-1 px-3 py-2"
                        style={{ background: "var(--bg)" }}
                      />
                      {current.state === "published" && (
                        <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => void saveLink()}>
                          Save link
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                      {linkSaved || "The student sees this as “See your post”."}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {canJudge && (
                    <>
                      <button className="btn" disabled={busy} onClick={() => decide("approved")}>
                        Approve <kbd className="ml-1 font-mono text-xs opacity-60">A</kbd>
                      </button>
                      {state === "in_review" && (
                        <button className="btn btn-quiet" disabled={busy} onClick={() => decide("changes_requested")}>
                          Ask for changes <kbd className="ml-1 font-mono text-xs opacity-60">R</kbd>
                        </button>
                      )}
                      <button className="btn btn-quiet" disabled={busy} onClick={() => decide("rejected")}>
                        Reject <kbd className="ml-1 font-mono text-xs opacity-60">X</kbd>
                      </button>
                    </>
                  )}
                  {current.state === "approved" && (
                    <button className="btn" disabled={busy || !canPublish} onClick={() => decide("published")}>
                      Mark posted <kbd className="ml-1 font-mono text-xs opacity-60">P</kbd>
                    </button>
                  )}
                  <a className="btn btn-quiet" href={`/api/captures/${current.id}/media?disposition=attachment`}>
                    Download original
                  </a>
                  {(current.state === "published" || current.state === "approved") && !takingDown && (
                    <button
                      className="btn btn-quiet"
                      style={{ borderColor: "var(--clay)", color: "var(--clay)" }}
                      onClick={() => setTakingDown(true)}
                    >
                      Take down…
                    </button>
                  )}
                </div>

                {current.state === "approved" && !canPublish && (
                  <div className="text-sm" style={{ color: "var(--clay)" }}>
                    <p className="font-semibold">Can&rsquo;t post yet:</p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {postBlockers.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  </div>
                )}

                {takingDown && (
                  <div className="flex flex-col gap-2 rounded-sm border p-3" style={{ borderColor: "var(--clay)" }}>
                    <p className="text-sm font-semibold" style={{ color: "var(--clay)" }}>Take this down</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      Remove the post from the platform yourself, then record it here. The student gets the message above.
                    </p>
                    <label className="label" htmlFor="takedown-reason">Reason (staff record, permanent)</label>
                    <input
                      id="takedown-reason"
                      value={takedownReason}
                      onChange={(e) => setTakedownReason(e.target.value)}
                      className="card px-3 py-2"
                      style={{ background: "var(--bg)" }}
                      placeholder="Parent asked for removal"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn"
                        style={{ background: "var(--clay)", borderColor: "var(--clay)" }}
                        disabled={busy || !message.trim() || !takedownReason.trim()}
                        onClick={() => void takeDown()}
                      >
                        {busy ? "Taking down…" : "Take down"}
                      </button>
                      <button className="btn btn-quiet" onClick={() => setTakingDown(false)}>Cancel</button>
                    </div>
                    {(!message.trim() || !takedownReason.trim()) && (
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        Needs {!message.trim() ? "a message to the student" : ""}{!message.trim() && !takedownReason.trim() ? " and " : ""}{!takedownReason.trim() ? "a reason" : ""}.
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">
                    {error}
                  </p>
                )}
                <p className="label">J / K to move · A R X P to decide</p>
              </div>
            )}
          </div>
        </section>
      )}
      </div>
      )}
    </div>
  );
}

function AskedFor({ row, extras }: { row: QueueRow; extras?: CaptureExtras }) {
  const personBlockers = new Map<string, string[]>();
  const otherBlockers: string[] = [];
  for (const blocker of row.consent_blockers ?? []) {
    if (blocker.person_id) {
      personBlockers.set(blocker.person_id, [...(personBlockers.get(blocker.person_id) ?? []), describeBlocker({ ...blocker, person: undefined })]);
    } else {
      otherBlockers.push(describeBlocker(blocker));
    }
  }
  const format = [
    row.media_type === "photo_series" ? `${row.media_items?.length ?? 0} photos` : row.media_type,
    row.orientation && row.orientation !== "any" ? row.orientation : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="mt-4 rounded-sm border p-4" style={{ borderColor: "var(--rule)" }}>
      <p className="label">Asked for</p>
      <p className="mt-2 text-sm font-semibold">{row.idea_title}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{row.idea_brief}</p>
      <p className="mt-2 text-sm">
        <span style={{ color: "var(--muted)" }}>Format:</span> {format}
        {" · "}
        <span style={{ color: "var(--muted)" }}>Safety rules:</span>{" "}
        {row.checklist_ticked?.length ? "acknowledged" : "not acknowledged"}
      </p>

      <p className="label mt-3">Who&rsquo;s in it</p>
      {row.no_people_in_frame ? (
        <p className="mt-1 text-sm">Student says nobody is recognisable.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {(extras?.tagged ?? []).map((person) => {
            const issues = personBlockers.get(person.personId);
            return (
              <li key={person.personId}>
                <span className="font-semibold">{person.name}</span>{" "}
                {issues ? (
                  <span style={{ color: "var(--clay)" }}>{issues.join(" ")}</span>
                ) : (
                  <span style={{ color: "var(--moss)" }}>release on file</span>
                )}
              </li>
            );
          })}
          {(extras?.tagged.length ?? 0) === 0 && <li style={{ color: "var(--muted)" }}>Nobody tagged.</li>}
        </ul>
      )}
      {otherBlockers.map((b) => (
        <p key={b} className="mt-1 text-sm" style={{ color: "var(--clay)" }}>{b}</p>
      ))}
    </section>
  );
}

function SafetyReportsInbox({ rows, onSaved }: { rows: SafetyReportRow[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handled(row: SafetyReportRow) {
    setBusy(row.id);
    setError("");
    const response = await fetch(`/api/safety/${row.id}`, { method: "POST" });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "" }));
      setError(body.error || "That didn't save.");
      return;
    }
    onSaved();
  }

  return (
    <section className="card p-5" style={{ borderColor: "var(--clay)" }}>
      <p className="label" style={{ color: "var(--clay)" }}>Safety reports from students · {rows.length}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: "var(--rule)" }}>
            <p className="font-semibold">
              {row.kind.replaceAll("_", " ")}{row.ideaTitle ? ` · ${row.ideaTitle}` : ""}
            </p>
            <p className="mt-1 text-[15px]">{row.detail}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {row.reporter} · {new Date(row.createdAt).toLocaleString()}
            </p>
            <button className="btn btn-quiet mt-2" disabled={busy === row.id} onClick={() => void handled(row)}>
              Mark handled
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
    </section>
  );
}

function WithdrawalInbox({ rows, onSaved }: { rows: WithdrawalRow[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [denying, setDenying] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function decide(row: WithdrawalRow, decision: "approved" | "denied") {
    if (decision === "denied" && !reason.trim()) {
      setError("Tell the student why it can't be withdrawn yet.");
      return;
    }
    setBusy(row.id);
    setError("");
    const response = await fetch(`/api/withdrawals/${row.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason: decision === "denied" ? reason.trim() : undefined }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "" }));
      setError(body.error || "That didn't save.");
      return;
    }
    setDenying(null);
    setReason("");
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
            {denying === row.id ? (
              <div className="mt-2 flex flex-col gap-2">
                <label className="label" htmlFor={`deny-${row.id}`}>Message to student</label>
                <input
                  id={`deny-${row.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="card px-3 py-2"
                  style={{ background: "var(--bg)" }}
                  placeholder="It's already in the printed program; we'll pull it from the next run."
                />
                <div className="flex gap-2">
                  <button className="btn" disabled={busy === row.id || !reason.trim()} onClick={() => void decide(row, "denied")}>Send and keep it</button>
                  <button className="btn btn-quiet" onClick={() => setDenying(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button className="btn" disabled={busy === row.id} onClick={() => void decide(row, "approved")}>Approve withdrawal</button>
                <button className="btn btn-quiet" disabled={busy === row.id} onClick={() => { setDenying(row.id); setReason(""); }}>Keep in workflow…</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
    </section>
  );
}
