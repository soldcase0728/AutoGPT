"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Chip } from "@/components/Chip";
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
  uploading: "Upload not submitted",
  submitted: "Waiting for review",
  in_review: "Being reviewed",
  withdrawal_requested: "Withdrawal requested",
  withdrawn: "Withdrawn",
  approved: "Accepted",
  changes_requested: "Reshoot requested",
  rejected: "Not accepted",
  published: "Posted",
};

export interface SubmissionRow {
  id: string;
  captureId: string | null;
  state: YoursState;
  occurredAt: string;
  ideaTitle: string;
  oneLiner: string | null;
  reviewNote: string | null;
  source: "Assigned" | "Open Moment";
  actionHref: string | null;
  withdrawMode: "direct" | "request" | null;
}

export function SubmissionsView({ person, rows }: { person: Person; rows: SubmissionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function withdraw(row: SubmissionRow) {
    if (!row.captureId || !row.withdrawMode || busy) return;
    const explanation = window.prompt(
      row.withdrawMode === "direct"
        ? "Optional: why are you withdrawing this?"
        : "Tell the marketing desk why this needs to be withdrawn.",
      "",
    );
    if (explanation === null) return;
    setBusy(row.id);
    setError("");
    const response = await fetch(`/api/captures/${row.captureId}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: explanation.trim() || undefined }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "That did not save." }));
      setError(body.error ?? "That did not save.");
      return;
    }
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

        {error && <p className="mt-4 text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
        {rows.length === 0 ? (
          <p className="mt-4 text-[15px]" style={{ color: "var(--muted)" }}>
            Nothing here yet. <Link href="/" className="underline underline-offset-4">Today&rsquo;s prompt</Link> will appear here when it is assigned.
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={TONE[row.state]}>{SAID[row.state]}</Chip>
                    <Chip>{row.source}</Chip>
                  </div>
                  <span className="label">{new Date(row.occurredAt).toLocaleDateString()}</span>
                </div>
                <p className="mt-2 text-[15px] font-semibold">{row.ideaTitle}</p>
                {row.oneLiner && <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>&ldquo;{row.oneLiner}&rdquo;</p>}
                {row.reviewNote && (
                  <p className="mt-3 rounded-sm border p-3 text-sm" style={{ borderColor: "var(--rule)", background: "var(--sunk)" }}>
                    <span className="font-semibold">Marketing desk:</span> {row.reviewNote}
                  </p>
                )}
                {(row.actionHref || row.withdrawMode) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.actionHref && <Link className="btn" href={row.actionHref}>Capture this</Link>}
                    {row.withdrawMode && (
                      <button className="btn btn-quiet" type="button" disabled={busy === row.id} onClick={() => void withdraw(row)}>
                        {busy === row.id
                          ? "Saving…"
                          : row.withdrawMode === "direct"
                            ? "Withdraw"
                            : "Request withdrawal"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
