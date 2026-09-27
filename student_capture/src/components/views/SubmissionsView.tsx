"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Chip } from "@/components/Chip";
import { Thumbnail } from "@/components/Thumbnail";
import { StudentProgressCard } from "@/components/StudentProgressCard";
import { shotsHeading } from "@/lib/names";
import { shortDate } from "@/lib/dates";
import { resolveShotsTab, splitShots, type ShotsTab } from "@/lib/my-shots";
import type { StudentProgress } from "@/lib/student-progress";
import type { CaptureState, Person } from "@/lib/types";

/** "reshooting": a shot sent back for changes that the student has started to redo. */
type YoursState = CaptureState | "assigned" | "expired" | "taken_down" | "reshooting";
type Tone = "muted" | "good" | "bad" | "accent";

const TONE: Record<YoursState, Tone> = {
  assigned: "accent",
  expired: "muted",
  uploading: "accent",
  submitted: "muted",
  in_review: "accent",
  withdrawal_requested: "accent",
  withdrawn: "muted",
  approved: "good",
  changes_requested: "accent",
  reshooting: "accent",
  rejected: "bad",
  published: "good",
  taken_down: "bad",
};

const SAID: Record<YoursState, string> = {
  assigned: "Assigned to you",
  expired: "Expired",
  uploading: "Not sent yet",
  submitted: "Waiting for review",
  in_review: "Being reviewed",
  withdrawal_requested: "Withdrawal requested",
  withdrawn: "Withdrawn",
  approved: "Accepted",
  changes_requested: "Sent back",
  reshooting: "Sent back",
  rejected: "Not accepted",
  published: "Posted",
  taken_down: "Taken down",
};

const ACTION_LABEL = {
  reshoot: "Reshoot",
  finish: "Finish sending",
  finishReshoot: "Reshoot",
  capture: "Capture this",
} as const;

/**
 * States whose old picture would mislead: the shot was sent back, is being
 * redone, or won't be used. They show a status tile instead of the media.
 */
const STATUS_TILE: Partial<Record<YoursState, { text: string; tone: "bad" | "accent" }>> = {
  changes_requested: { text: "Sent back", tone: "accent" },
  reshooting: { text: "Sent back", tone: "accent" },
  rejected: { text: "Not accepted", tone: "bad" },
  taken_down: { text: "Taken down", tone: "bad" },
};

function isSentBack(state: YoursState) {
  return state === "changes_requested" || state === "reshooting";
}

/** What the reviewer's message is, in this state. */
function noteLabel(state: YoursState): string {
  if (state === "changes_requested" || state === "reshooting") return "What to fix:";
  if (state === "rejected") return "Why it wasn\u2019t used:";
  if (state === "taken_down") return "Why it came down:";
  return "Marketing desk:";
}

export interface SubmissionRow {
  id: string;
  captureId: string | null;
  state: YoursState;
  occurredAt: string;
  ideaTitle: string;
  oneLiner: string | null;
  reviewNote: string | null;
  source: "Assigned" | "Open Moment";
  /** Null for an assignment with nothing shot yet. */
  thumbnail: { src: string; kind: "photo" | "video" } | null;
  /** Where a posted item lives, when the marketing desk recorded it. */
  postUrl: string | null;
  /** The date it was Shot of the Day, if it was. */
  awardedOn?: string | null;
  action: { kind: keyof typeof ACTION_LABEL; href: string } | null;
  withdrawMode: "direct" | "request" | null;
}

export function SubmissionsView({
  person,
  rows,
  progress = null,
  initialTab = null,
}: {
  person: Person;
  rows: SubmissionRow[];
  /** From ?tab=; otherwise open tasks if there are any. */
  initialTab?: string | null;
  /** The record strip. The latest post is already in the list, so it is left out here. */
  progress?: StudentProgress | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ rowId: string; message: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function openWithdraw(row: SubmissionRow) {
    setWithdrawing(row.id);
    setReason("");
    setError(null);
  }

  async function withdraw(row: SubmissionRow) {
    if (!row.captureId || !row.withdrawMode || busy) return;
    setBusy(row.id);
    setError(null);
    const response = await fetch(`/api/captures/${row.captureId}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "" }));
      setError({ rowId: row.id, message: body.error || "That didn't save. Try again." });
      return;
    }
    setWithdrawing(null);
    router.refresh();
  }

  async function reshoot(row: SubmissionRow) {
    if (!row.captureId || !row.action || busy) return;
    setBusy(row.id);
    setError(null);
    const response = await fetch(`/api/captures/${row.captureId}/resubmit`, { method: "POST" });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "" }));
      setError({ rowId: row.id, message: body.error || "Could not start the reshoot." });
      return;
    }
    router.push(row.action.href);
    router.refresh();
  }

  const split = splitShots(rows);
  const [tab, setTab] = useState<ShotsTab>(() => resolveShotsTab(initialTab, split.open.length));

  function chooseTab(next: ShotsTab) {
    setTab(next);
    // Keep the tab in the address so a refresh or the back button returns here.
    window.history.replaceState(null, "", `/submissions?tab=${next}`);
  }

  function renderRow(row: SubmissionRow) {
    return (
        <li key={row.id} className="card p-4">
          <div className="flex gap-4">
            <Thumbnail
              src={STATUS_TILE[row.state] ? null : (row.thumbnail?.src ?? null)}
              kind={row.thumbnail?.kind ?? "photo"}
              label={`${row.ideaTitle}${row.oneLiner ? `: ${row.oneLiner}` : ""}`}
              placeholder={STATUS_TILE[row.state] ?? null}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={TONE[row.state]}>{SAID[row.state]}</Chip>
                  {row.awardedOn && (
                    <span
                      className="inline-block rounded-sm px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
                      style={{ background: "var(--brand)", color: "#fff" }}
                      title={`Shot of the Day, ${row.awardedOn}`}
                    >
                      ★ Shot of the Day
                    </span>
                  )}
                  <Chip>{row.source}</Chip>
                </div>
                <span className="label">{shortDate(row.occurredAt)}</span>
              </div>
              {isSentBack(row.state) && row.reviewNote && (
                <p className="mt-2 text-[15px] font-semibold leading-snug">{row.reviewNote}</p>
              )}
              <p className={`mt-2 text-[15px] ${isSentBack(row.state) ? "" : "font-semibold"}`} style={isSentBack(row.state) ? { color: "var(--muted)" } : undefined}>
                {row.ideaTitle}
              </p>
              {row.oneLiner && (
                <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
                  &ldquo;{row.oneLiner}&rdquo;
                </p>
              )}
              {row.state === "published" && (
                <p className="mt-2 text-[15px]">
                  {row.postUrl ? (
                    <a
                      href={row.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline underline-offset-4"
                      style={{ color: "var(--moss)" }}
                    >
                      See your post
                    </a>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>
                      It&rsquo;s live. The marketing desk hasn&rsquo;t added the link yet.
                    </span>
                  )}
                </p>
              )}
              {row.state === "uploading" && (
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  You started this but didn&rsquo;t tap Send it. Nobody can see it yet.
                </p>
              )}

            </div>
          </div>
    
          {row.reviewNote && !isSentBack(row.state) && (
            <p
              className="mt-3 rounded-sm border p-3 text-sm"
              style={{
                borderColor: row.state === "rejected" || row.state === "taken_down" ? "var(--clay)" : "var(--rule)",
                background: "var(--sunk)",
              }}
            >
              <span className="font-semibold">{noteLabel(row.state)}</span> {row.reviewNote}
            </p>
          )}
    
          {withdrawing === row.id ? (
            <form
              className="mt-3 flex flex-col gap-2 rounded-sm border p-3"
              style={{ borderColor: "var(--rule)" }}
              onSubmit={(event) => {
                event.preventDefault();
                void withdraw(row);
              }}
            >
              <p className="text-[15px] font-semibold">
                {row.withdrawMode === "direct" ? "Withdraw this?" : "Ask to withdraw this?"}
              </p>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {row.withdrawMode === "direct"
                  ? "It's removed straight away. Nobody at the marketing desk has seen it."
                  : row.state === "published"
                    ? "The marketing desk will take the post down and remove it. They'll reply here."
                    : "The marketing desk has already seen it, so they'll confirm. They'll reply here."}
              </p>
              <label className="label mt-1" htmlFor={`reason-${row.id}`}>
                {row.withdrawMode === "direct" ? "Why? (optional)" : "Why? This helps them act quickly"}
              </label>
              <textarea
                id={`reason-${row.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                className="card px-3 py-2 text-[15px]"
                style={{ background: "var(--bg)" }}
                placeholder="Someone in it asked me to take it down"
              />
              <div className="flex flex-wrap gap-2">
                <button className="btn" type="submit" disabled={busy === row.id}>
                  {busy === row.id
                    ? "Sending…"
                    : row.withdrawMode === "direct"
                      ? "Withdraw it"
                      : "Send request"}
                </button>
                <button
                  className="btn btn-quiet"
                  type="button"
                  disabled={busy === row.id}
                  onClick={() => setWithdrawing(null)}
                >
                  Keep it
                </button>
              </div>
            </form>
          ) : (
            (row.action || row.withdrawMode) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {row.action?.kind === "reshoot" ? (
                  <button className="btn" disabled={busy === row.id} onClick={() => void reshoot(row)}>
                    {ACTION_LABEL.reshoot}
                  </button>
                ) : (
                  row.action && (
                    <Link className="btn" href={row.action.href}>
                      {ACTION_LABEL[row.action.kind]}
                    </Link>
                  )
                )}
                {row.withdrawMode && (
                  <button
                    className="btn btn-quiet"
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => openWithdraw(row)}
                  >
                    {row.withdrawMode === "direct" ? "Withdraw" : "Request withdrawal"}
                  </button>
                )}
              </div>
            )
          )}
          {error?.rowId === row.id && (
            <p className="mt-2 text-sm" style={{ color: "var(--clay)" }} role="alert">
              {error.message}
            </p>
          )}
        </li>
    );
  }

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{shotsHeading(person.display_name)}</h1>
        <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
          What you&rsquo;ve sent, and what&rsquo;s still to do.
        </p>

        {rows.length === 0 ? (
          <p className="mt-4 text-[15px]" style={{ color: "var(--muted)" }}>
            Nothing here yet. <Link href="/" className="underline underline-offset-4">Today&rsquo;s prompt</Link> will appear here when it is assigned.
          </p>
        ) : (
          <>
            <nav className="mt-5 flex gap-2 border-b" style={{ borderColor: "var(--rule)" }} aria-label="My shots">
              {([
                ["done", "My shots", split.done.length],
                ["open", "Open tasks", split.open.length],
              ] as const).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseTab(id)}
                  aria-current={tab === id ? "page" : undefined}
                  className="-mb-px border-b-2 px-3 py-2 text-[15px] font-semibold"
                  style={{
                    borderColor: tab === id ? "var(--brand)" : "transparent",
                    color: tab === id ? "var(--ink)" : "var(--muted)",
                  }}
                >
                  {label} <span className="font-mono text-xs tabular-nums">{count}</span>
                </button>
              ))}
            </nav>

            {tab === "done" ? (
              <>
                {progress && (
                  <div className="mt-4">
                    <StudentProgressCard progress={{ ...progress, recent: null }} />
                  </div>
                )}
                {split.done.length ? (
                  <ul className="mt-4 flex flex-col gap-3">{split.done.map(renderRow)}</ul>
                ) : (
                  <p className="mt-4 text-[15px]" style={{ color: "var(--muted)" }}>
                    Nothing sent yet. Your shots show up here once you send them.
                  </p>
                )}
              </>
            ) : (
              <>
                {split.open.length ? (
                  <ul className="mt-4 flex flex-col gap-3">{split.open.map(renderRow)}</ul>
                ) : (
                  <p className="mt-4 text-[15px]" style={{ color: "var(--muted)" }}>
                    You&rsquo;re all caught up. New tasks show up here when they&rsquo;re assigned.
                  </p>
                )}
                {split.missed.length > 0 && (
                  <>
                    <p className="label mt-6">Missed</p>
                    <ul className="mt-2 flex flex-col gap-3 opacity-70">{split.missed.map(renderRow)}</ul>
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
