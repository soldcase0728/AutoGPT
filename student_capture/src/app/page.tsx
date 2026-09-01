import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { PromptCard } from "@/components/PromptCard";
import { Chip } from "@/components/Chip";
import { createClient } from "@/lib/supabase/server";
import { hasSignedRelease, requirePerson } from "@/lib/session";
import { buildChecklist } from "@/lib/guidelines";
import type { GuidelineVersion, Idea } from "@/lib/types";
import { isoDate } from "@/lib/assign";

export const dynamic = "force-dynamic";

export default async function Today() {
  const person = await requirePerson();

  if (person.role === "student" && !(await hasSignedRelease(person.id))) {
    redirect("/consent");
  }

  const supabase = await createClient();
  const today = isoDate(new Date());

  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, due_on, completed_at, ideas!inner(id, title, brief, format_spec, reference_urls, guideline_set_ids, campaigns(name))",
    )
    .eq("person_id", person.id)
    .eq("due_on", today)
    .maybeSingle();

  const idea = (assignment?.ideas ?? null) as unknown as
    | (Idea & { campaigns?: { name: string } })
    | null;

  let versions: GuidelineVersion[] = [];
  if (idea?.guideline_set_ids?.length) {
    const { data } = await supabase
      .from("guideline_versions")
      .select("id, set_id, version, body")
      .in("set_id", idea.guideline_set_ids)
      .is("superseded_at", null);
    versions = (data ?? []) as GuidelineVersion[];
  }
  const checklist = buildChecklist(versions);

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <p className="label">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>

        {!idea || !assignment ? (
          <div className="card mt-4 p-5">
            <h1 className="text-xl font-bold tracking-tight">Nothing to shoot today</h1>
            <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>
              Prompts land each morning. If you think one is missing, tell the marketing
              desk.
            </p>
            {(person.role === "reviewer" || person.role === "admin") && (
              <Link href="/review" className="btn mt-5 inline-block">
                Open the review queue
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-5">
            <PromptCard
              title={idea.title}
              brief={idea.brief}
              spec={idea.format_spec}
              campaign={idea.campaigns?.name}
            />

            {checklist.items.length > 0 && (
              <section className="card p-5">
                <p className="label">Before you shoot</p>
                <ul className="mt-3 flex flex-col gap-2 text-[15px]">
                  {checklist.items.slice(0, 6).map((item) => (
                    <li key={item.id} className="flex gap-3">
                      <span aria-hidden style={{ color: "var(--accent)" }}>
                        —
                      </span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {assignment.completed_at ? (
              <div className="card flex items-center justify-between gap-4 p-5">
                <div>
                  <Chip tone="good">Sent</Chip>
                  <p className="mt-2 text-[15px]">
                    That is today done. We will tell you if it goes out.
                  </p>
                </div>
                <Link href="/submissions" className="btn btn-quiet whitespace-nowrap">
                  Your clips
                </Link>
              </div>
            ) : (
              <Link href={`/capture/${assignment.id}`} className="btn text-center">
                Shoot it
              </Link>
            )}
          </div>
        )}
      </main>
    </>
  );
}
