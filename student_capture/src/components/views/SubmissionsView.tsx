import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { Chip } from "@/components/Chip";
import type { CaptureState, Person } from "@/lib/types";

const TONE: Record<CaptureState, "muted" | "good" | "bad" | "accent"> = {
  uploading: "muted",
  submitted: "muted",
  in_review: "accent",
  approved: "good",
  changes_requested: "accent",
  rejected: "bad",
  published: "good",
};

/** What each state means to the student, in their words rather than the schema's. */
const SAID: Record<CaptureState, string> = {
  uploading: "Never finished uploading",
  submitted: "With the marketing desk",
  in_review: "Being looked at",
  approved: "Approved",
  changes_requested: "Needs another go",
  rejected: "Not used",
  published: "Posted",
};

export interface SubmissionRow {
  id: string;
  state: CaptureState;
  created_at: string;
  submitted_at: string | null;
  ideaTitle: string;
  oneLiner: string | null;
}

export function SubmissionsView({
  person,
  rows,
}: {
  person: Person;
  rows: SubmissionRow[];
}) {
  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold tracking-tight">What you have sent</h1>

        {rows.length === 0 ? (
          <p className="mt-4 text-[15px]" style={{ color: "var(--muted)" }}>
            Nothing yet.{" "}
            <Link href="/" className="underline underline-offset-4">
              Today&rsquo;s prompt
            </Link>{" "}
            is waiting.
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Chip tone={TONE[row.state]}>{SAID[row.state]}</Chip>
                  <span className="label">
                    {new Date(row.submitted_at ?? row.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-2 text-[15px] font-semibold">{row.ideaTitle}</p>
                {row.oneLiner && (
                  <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
                    &ldquo;{row.oneLiner}&rdquo;
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
