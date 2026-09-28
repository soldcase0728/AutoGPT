import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PromptCard } from "@/components/PromptCard";
import { Chip } from "@/components/Chip";
import { StudentProgressCard } from "@/components/StudentProgressCard";
import type { StudentProgress } from "@/lib/student-progress";
import { firstName } from "@/lib/names";
import { Greeting } from "@/components/Greeting";
import type { Idea, Person } from "@/lib/types";
import { dayLabel } from "@/lib/dates";

/** A shot the desk returned; it leads Today until it's reshot. */
export interface TodaySentBack {
  assignmentId: string;
  title: string;
  note: string | null;
}

export interface TodayViewProps {
  person: Person;
  /** Null when the morning job has not assigned anything for today. */
  assignment: { id: string; completed_at: string | null } | null;
  idea: (Idea & { campaigns?: { name: string } }) | null;
  /** Injected so the view renders identically whatever day it is screenshotted. */
  today?: Date;
  /** Students only: their record and what went live. */
  progress?: StudentProgress | null;
  sentBack?: TodaySentBack | null;
}

export function TodayView({
  person,
  assignment,
  idea,
  today = new Date(),
  progress = null,
  sentBack = null,
}: TodayViewProps) {
  const todayIsSentBack = Boolean(sentBack && assignment && sentBack.assignmentId === assignment.id);
  const isStaff = person.role === "reviewer" || person.role === "admin";

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        {!isStaff && (
          <Greeting name={firstName(person.display_name)} />
        )}
        <p className="label">
          {dayLabel(today)}
        </p>

        {sentBack && (
          <section className="card mt-4 p-5" style={{ borderColor: "var(--accent)", borderWidth: 2 }} aria-label="Sent back">
            <Chip tone="accent">Sent back</Chip>
            <p className="mt-3 text-[17px] font-semibold leading-snug">
              {sentBack.note ?? "The marketing desk asked for a new take."}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {sentBack.title} · from the marketing desk
            </p>
            <Link href={`/capture/${sentBack.assignmentId}`} className="btn mt-4 block text-center">
              Reshoot
            </Link>
          </section>
        )}

        {todayIsSentBack ? null : !idea || !assignment ? (
          // With a reshoot waiting, that is today's story; "nothing today" would contradict it.
          sentBack ? null : (
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
          )
        ) : assignment.completed_at ? (
          // One card per assignment: a sent prompt is a single "done" card, not
          // the prompt again with no button under it.
          sentBack ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Today&rsquo;s prompt, &ldquo;{idea.title}&rdquo;, is sent.
            </p>
          ) : (
            <section className="card mt-4 flex items-center justify-between gap-4 p-5" aria-label="Today is done">
              <div>
                <Chip tone="good">Sent</Chip>
                <p className="mt-2 text-[17px] font-semibold leading-snug">{idea.title}</p>
                <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
                  That is today done. When it goes live, it shows up here.
                </p>
              </div>
              <Link href="/submissions" className="btn btn-quiet whitespace-nowrap">
                My shots
              </Link>
            </section>
          )
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
            <Link href={`/capture/${assignment.id}`} className="btn text-center">
              Shoot it
            </Link>
          </div>
        )}

        {progress && (
          <div className="mt-5">
            <StudentProgressCard progress={progress} />
          </div>
        )}
      </main>
    </>
  );
}
