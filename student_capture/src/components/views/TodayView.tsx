import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PromptCard } from "@/components/PromptCard";
import { Chip } from "@/components/Chip";
import type { Checklist } from "@/lib/guidelines";
import type { Idea, Person } from "@/lib/types";

export interface TodayViewProps {
  person: Person;
  /** Null when the morning job has not assigned anything for today. */
  assignment: { id: string; completed_at: string | null } | null;
  idea: (Idea & { campaigns?: { name: string } }) | null;
  checklist: Checklist;
  /** Injected so the view renders identically whatever day it is screenshotted. */
  today?: Date;
}

export function TodayView({
  person,
  assignment,
  idea,
  checklist,
  today = new Date(),
}: TodayViewProps) {
  const isStaff = person.role === "reviewer" || person.role === "admin";

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <p className="label">
          {today.toLocaleDateString(undefined, {
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
            {isStaff && (
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
              mediaType={idea.media_type}
              orientation={idea.orientation}
              minMediaCount={idea.min_media_count}
              maxMediaCount={idea.max_media_count}
              minDurationSeconds={idea.min_duration_seconds}
              maxDurationSeconds={idea.max_duration_seconds}
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
