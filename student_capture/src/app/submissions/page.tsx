import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { Chip } from "@/components/Chip";
import { createClient } from "@/lib/supabase/server";
import { requirePerson } from "@/lib/session";
import type { CaptureState } from "@/lib/types";

export const dynamic = "force-dynamic";

const TONE: Record<CaptureState, "muted" | "good" | "bad" | "accent"> = {
  uploading: "muted",
  submitted: "muted",
  in_review: "accent",
  approved: "good",
  changes_requested: "accent",
  rejected: "bad",
  published: "good",
};

const SAID: Record<CaptureState, string> = {
  uploading: "Never finished uploading",
  submitted: "With the marketing desk",
  in_review: "Being looked at",
  approved: "Approved",
  changes_requested: "Needs another go",
  rejected: "Not used",
  published: "Posted",
};

export default async function Submissions() {
  const person = await requirePerson();
  const supabase = await createClient();

  const { data: captures } = await supabase
    .from("captures")
    .select(
      "id, state, created_at, submitted_at, duration_s, capture_context(one_liner), assignments!inner(ideas!inner(title))",
    )
    .eq("person_id", person.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (captures ?? []) as unknown as Array<{
    id: string;
    state: CaptureState;
    created_at: string;
    submitted_at: string | null;
    duration_s: number | null;
    capture_context: { one_liner: string } | null;
    assignments: { ideas: { title: string } };
  }>;

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
                <p className="mt-2 text-[15px] font-semibold">
                  {row.assignments?.ideas?.title}
                </p>
                {row.capture_context?.one_liner && (
                  <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
                    &ldquo;{row.capture_context.one_liner}&rdquo;
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
