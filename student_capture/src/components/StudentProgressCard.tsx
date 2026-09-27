import { Chip } from "./Chip";
import { TeamBoard } from "./TeamBoard";
import type { StudentProgress } from "@/lib/student-progress";
import { awardDateLabel, recentAwards } from "@/lib/shot-of-the-day";
import { isoDate } from "@/lib/assign";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-bold tabular-nums tracking-tight">{value}</span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>{label}</span>
    </div>
  );
}

/**
 * The payoff for sending things: the newest post of theirs that went live,
 * their streak and totals, and what the school and their team did this week.
 * Team and school figures are counts only; nobody else is named.
 */
export function StudentProgressCard({ progress }: { progress: StudentProgress }) {
  const { record, recent, community, board, awards } = progress;
  const [latestAward] = recentAwards(awards, isoDate(new Date()));
  const showCommunity = community && (community.weekPosted > 0 || community.weekContributors > 0 || community.groups.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {latestAward && (
        <section
          className="card p-4"
          style={{ borderLeft: "3px solid var(--brand)", borderColor: "var(--brand)" }}
          aria-label="Shot of the Day"
        >
          <p className="text-sm font-bold uppercase tracking-[0.12em]" style={{ color: "var(--brand-ink)" }}>
            ★ Shot of the Day
          </p>
          <p className="mt-2 text-[15px]">
            Your shot for <span className="font-semibold">&ldquo;{latestAward.title}&rdquo;</span> was picked
            as the Shot of the Day for {awardDateLabel(latestAward.awardedOn)}.
          </p>
          {latestAward.note && (
            <p className="mt-2 text-[15px] italic">&ldquo;{latestAward.note}&rdquo; — the marketing desk</p>
          )}
          {latestAward.postUrl && (
            <a
              href={latestAward.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-[15px] font-semibold underline underline-offset-4"
              style={{ color: "var(--brand-ink)" }}
            >
              See it posted
            </a>
          )}
        </section>
      )}

      {recent && recent.id !== latestAward?.captureId && (
        <section className="card p-4" style={{ borderLeft: "3px solid var(--moss)" }} aria-label="Your latest post">
          <Chip tone="good">Posted</Chip>
          <p className="mt-2 text-[15px]">
            Your shot for <span className="font-semibold">&ldquo;{recent.title}&rdquo;</span> went live.
          </p>
          {recent.postUrl ? (
            <a
              href={recent.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-[15px] font-semibold underline underline-offset-4"
              style={{ color: "var(--moss)" }}
            >
              See your post
            </a>
          ) : (
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              The marketing desk posted it on the school&rsquo;s accounts.
            </p>
          )}
        </section>
      )}

      <section className="card p-4" aria-label="Your record">
        <p className="label">Your record</p>
        {record.sent ? (
          <div className={`mt-3 grid gap-3 ${awards.length ? "grid-cols-4" : "grid-cols-3"}`}>
            <Stat value={record.streak} label="in a row" />
            <Stat value={record.sent} label="sent" />
            <Stat value={record.posted} label="posted" />
            {awards.length > 0 && <Stat value={awards.length} label={awards.length === 1 ? "shot of the day" : "shots of the day"} />}
          </div>
        ) : (
          <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>
            Send your first one and your streak starts here.
          </p>
        )}

        {showCommunity && (
          <div className="mt-4 border-t pt-3 text-sm" style={{ borderColor: "var(--rule)" }}>
            {(community.weekPosted > 0 || community.weekContributors > 0) && (
              <p>
                <span className="font-semibold">This week at school:</span>{" "}
                {community.weekContributors} student{community.weekContributors === 1 ? "" : "s"} sent shots
                {" "}and {community.weekPosted} went live.
              </p>
            )}
            {community.groups.map((group) => (
              <p key={group.name} className="mt-1" style={{ color: "var(--muted)" }}>
                <span style={{ color: "var(--ink)" }}>{group.name}:</span>{" "}
                {group.weekSent} sent this week across {group.members} of you.
              </p>
            ))}
          </div>
        )}

        {board && board.groups.length > 0 && <TeamBoard board={board} />}
      </section>
    </div>
  );
}
