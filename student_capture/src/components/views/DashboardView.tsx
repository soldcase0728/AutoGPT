import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { Chip } from "@/components/Chip";
import {
  elapsed,
  weekdayLabel,
  type AttentionItem,
  type DayParticipation,
  type QuietStudent,
  type UpcomingDay,
} from "@/lib/dashboard";
import type { Person } from "@/lib/types";

export interface DashboardViewProps {
  person: Person;
  today: string;
  now: Date;
  sentToday: { due: number; sent: number };
  queue: {
    toReview: number;
    oldestToReviewSince: string | null;
    waitingOnStudent: number;
    readyToPost: number;
    readyBlocked: number;
    postedThisWeek: number;
  };
  attention: AttentionItem[];
  participation: DayParticipation[];
  upcoming: UpcomingDay[];
  quiet: Array<QuietStudent & { email: string }>;
}

function shortDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Tile({
  href,
  label,
  value,
  note,
  children,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="card flex flex-col gap-1 p-4 hover:opacity-85">
      <span className="label">{label}</span>
      <span className="text-3xl font-bold tabular-nums tracking-tight">{value}</span>
      {children}
      {note && (
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {note}
        </span>
      )}
    </Link>
  );
}

/** Sent against due as a filled track. One ratio, one hue. */
function Meter({ sent, due }: { sent: number; due: number }) {
  const share = due ? Math.min(1, sent / due) : 0;
  return (
    <span
      className="mt-1 block h-1.5 w-full overflow-hidden rounded-full"
      style={{ background: "var(--sunk)" }}
      aria-hidden
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${share * 100}%`, background: "var(--ink)" }}
      />
    </span>
  );
}

/**
 * Due and sent for each of the last days. Each column's track is what was due;
 * the solid part is what came back. Hover or tap a column for its numbers, and
 * the same figures sit in the table underneath.
 */
function ParticipationChart({ days }: { days: DayParticipation[] }) {
  const max = Math.max(1, ...days.map((d) => d.due));
  const totalDue = days.reduce((n, d) => n + d.due, 0);
  const totalSent = days.reduce((n, d) => n + d.sent, 0);

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Sent, last {days.length} days</h2>
        <span className="text-sm tabular-nums" style={{ color: "var(--muted)" }}>
          {totalDue ? `${totalSent} of ${totalDue} · ${Math.round((totalSent / totalDue) * 100)}%` : "Nothing was due"}
        </span>
      </div>
      <div className="mt-4 flex h-32 items-end gap-[2px]" role="img" aria-label={`Assignments sent against due for the last ${days.length} days`}>
        {days.map((day) => {
          const label = `${shortDay(day.date)}: ${day.due ? `${day.sent} of ${day.due} sent` : "nothing due"}`;
          return (
            <div key={day.date} className="group relative flex h-full flex-1 items-end" title={label}>
              {day.due ? (
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-t"
                  style={{ height: `${(day.due / max) * 100}%`, background: "var(--sunk)" }}
                >
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${(day.sent / day.due) * 100}%`, background: "var(--ink)" }}
                  />
                </div>
              ) : (
                <div className="h-px w-full" style={{ background: "var(--rule)" }} />
              )}
              <span
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-sm px-2 py-1 text-xs group-hover:block"
                style={{ background: "var(--ink)", color: "var(--bg)" }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10.5px]" style={{ color: "var(--muted)" }}>
        <span>{shortDay(days[0]!.date)}</span>
        <span>{shortDay(days[days.length - 1]!.date)}</span>
      </div>
      <div className="mt-3 flex gap-4 text-xs" style={{ color: "var(--muted)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ink)" }} /> Sent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--sunk)" }} /> Due, not sent
        </span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer" style={{ color: "var(--muted)" }}>Show as a table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr className="label">
              <th className="py-1 font-normal">Day</th>
              <th className="py-1 font-normal">Due</th>
              <th className="py-1 font-normal">Sent</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} className="border-t" style={{ borderColor: "var(--rule)" }}>
                <td className="py-1">{shortDay(day.date)}</td>
                <td className="py-1">{day.due}</td>
                <td className="py-1">{day.sent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function DashboardView({
  person,
  today,
  now,
  sentToday,
  queue,
  attention,
  participation,
  upcoming,
  quiet,
}: DashboardViewProps) {
  const quietEmails = quiet.map((s) => s.email);
  const nudge = `mailto:?bcc=${encodeURIComponent(quietEmails.join(","))}&subject=${encodeURIComponent("We miss your clips")}&body=${encodeURIComponent(
    "Hi,\n\nWe haven't had anything from you for a few days. Today's prompt is waiting in the Capture app, and it takes under a minute.\n\nThanks!",
  )}`;

  return (
    <>
      <AppHeader person={person} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8">
        <header>
          <p className="label">Overview</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{weekdayLabel(today)}</h1>
          <p className="mt-1 text-[15px]" style={{ color: "var(--muted)" }}>
            {sentToday.due
              ? `${sentToday.sent} of ${sentToday.due} students have sent today's prompt.`
              : "No prompt went out today."}
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="At a glance">
          <Tile
            href="/admin/tasks"
            label="Sent today"
            value={sentToday.due ? `${sentToday.sent}/${sentToday.due}` : "—"}
            note={sentToday.due ? `${Math.round((sentToday.sent / sentToday.due) * 100)}% so far` : "Nothing due today"}
          >
            {sentToday.due > 0 && <Meter sent={sentToday.sent} due={sentToday.due} />}
          </Tile>
          <Tile
            href="/review?tab=review"
            label="To review"
            value={queue.toReview}
            note={[
              queue.oldestToReviewSince ? `Oldest waiting ${elapsed(queue.oldestToReviewSince, now)}` : "All caught up",
              queue.waitingOnStudent ? `${queue.waitingOnStudent} reshoot${queue.waitingOnStudent === 1 ? "" : "s"} out` : null,
            ].filter(Boolean).join(" · ")}
          />
          <Tile
            href="/review?tab=ready"
            label="Ready to post"
            value={queue.readyToPost}
            note={queue.readyBlocked ? `${queue.readyBlocked} blocked by a release` : queue.readyToPost ? "All clear to post" : "Nothing approved yet"}
          />
          <Tile
            href="/review?tab=posted"
            label="Posted"
            value={queue.postedThisWeek}
            note="In the last 7 days"
          />
        </section>

        <section aria-labelledby="attention">
          <h2 id="attention" className="text-base font-semibold">Needs attention</h2>
          {attention.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {attention.map((item) => (
                <li
                  key={item.id}
                  className="card flex flex-wrap items-center justify-between gap-3 p-4"
                  style={{ borderLeft: `3px solid ${item.tone === "bad" ? "var(--clay)" : "var(--accent)"}` }}
                >
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="font-semibold">
                      <span className="sr-only">{item.tone === "bad" ? "Urgent: " : "To do: "}</span>
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-sm" style={{ color: "var(--muted)" }}>{item.detail}</p>
                  </div>
                  <Link href={item.href} className="rounded-sm border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--ink)" }}>
                    {item.action}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card mt-2 p-4 text-[15px]" style={{ color: "var(--muted)" }}>
              Nothing needs you right now.
            </p>
          )}
        </section>

        <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
          <ParticipationChart days={participation} />

          <section className="card p-4" aria-labelledby="coming-up">
            <h2 id="coming-up" className="text-base font-semibold">Coming up</h2>
            <ul className="mt-3 flex flex-col">
              {upcoming.map((day) => (
                <li
                  key={day.date}
                  className="flex items-center justify-between border-t py-2 text-sm first:border-t-0"
                  style={{ borderColor: "var(--rule)" }}
                >
                  <span style={{ color: day.gap ? "var(--ink)" : "var(--muted)" }}>{shortDay(day.date)}</span>
                  {day.gap ? (
                    <Chip tone="accent">Nothing scheduled</Chip>
                  ) : day.assigned ? (
                    <span className="tabular-nums">{day.assigned} assigned</span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>Weekend</span>
                  )}
                </li>
              ))}
            </ul>
            <Link href="/admin/tasks" className="mt-3 inline-block text-sm underline underline-offset-4">
              Schedule a task
            </Link>
          </section>
        </div>

        <section className="card p-4" aria-labelledby="quiet">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="quiet" className="text-base font-semibold">Gone quiet</h2>
            <span className="text-sm" style={{ color: "var(--muted)" }}>Missed 2 or more in the last 7 days, sent none</span>
          </div>
          {quiet.length ? (
            <>
              <ul className="mt-3 flex flex-col">
                {quiet.map((student) => (
                  <li
                    key={student.personId}
                    className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm first:border-t-0"
                    style={{ borderColor: "var(--rule)" }}
                  >
                    <span className="font-semibold">{student.name}</span>
                    <span style={{ color: "var(--muted)" }}>
                      Missed {student.missed} · {student.lastSentOn ? `last sent ${shortDay(student.lastSentOn)}` : "hasn't sent anything yet"}
                    </span>
                  </li>
                ))}
              </ul>
              <a className="btn mt-3 inline-block text-sm" href={nudge}>
                Nudge {quiet.length === 1 ? "them" : `all ${quiet.length}`} by email
              </a>
            </>
          ) : (
            <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>
              Everyone with a prompt this week has sent something.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
