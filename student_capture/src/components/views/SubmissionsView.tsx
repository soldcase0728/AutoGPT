"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Chip } from "@/components/Chip";
import { Thumbnail } from "@/components/Thumbnail";
import type { CaptureState, Person } from "@/lib/types";

type YoursState = CaptureState | "assigned" | "expired";
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
  rejected: "bad",
  published: "good",
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
  changes_requested: "Reshoot requested",
  rejected: "Not accepted",
  published: "Posted",
};

const ACTION_LABEL = {
  reshoot: "Reshoot this",
  finish: "Finish sending",
  capture: "Capture this",
} as const;

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
  action: { kind: keyof typeof ACTION_LABEL; href: string } | null;
  withdrawMode: "direct" | "request" | null;
}

export function SubmissionsView({ person, rows }: { person: Person; rows: SubmissionRow[] }) {
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

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Yours</h1>
        <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
          Assignments, uploads, and review outcomes in one place.
        </p>

        {rows.length === 0 ? (
          <p className="mt-4 text-[15px]" style={{ color: "var(--muted)" }}>
            Nothing here yet. <Link href="/" className="underline underline-offset-4">Today&rsquo;s prompt</Link> will appear here when it is assigned.
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id} className="card p-4">
                <div className="flex gap-4">
                  <Thumbnail
                    src={row.thumbnail?.src ?? null}
                    kind={row.thumbnail?.kind ?? "photo"}
                    label={`${row.ideaTitle}${row.oneLiner ? `: ${row.oneLiner}` : ""}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={TONE[row.state]}>{SAID[row.state]}</Chip>
                        <Chip>{row.source}</Chip>
                      </div>
                      <span className="label">{new Date(row.occurredAt).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-2 text-[15px] font-semibold">{row.ideaTitle}</p>
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

                {row.reviewNote && (
                  <p className="mt-3 rounded-sm border p-3 text-sm" style={{ borderColor: "var(--rule)", background: "var(--sunk)" }}>
                    <span className="font-semibold">Marketing desk:</span> {row.reviewNote}
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
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
