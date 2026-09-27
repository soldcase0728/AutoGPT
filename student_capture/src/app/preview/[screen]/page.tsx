import { notFound } from "next/navigation";
import { demoScreensEnabled } from "@/lib/demo";
import { TodayView } from "@/components/views/TodayView";
import { SubmissionsView } from "@/components/views/SubmissionsView";
import { ConsentView } from "@/components/views/ConsentView";
import { ConsentForm } from "@/app/consent/ConsentForm";
import { CaptureFlow } from "@/app/capture/[assignmentId]/CaptureFlow";
import { ReviewQueue } from "@/app/review/ReviewQueue";
import { PosterView } from "@/components/views/PosterView";
import { PeopleManager } from "@/app/admin/people/PeopleManager";
import { TaskManager } from "@/app/admin/tasks/TaskManager";
import { DashboardView } from "@/components/views/DashboardView";
import { attentionItems, daysAfter, daysEnding, upcomingDays } from "@/lib/dashboard";
import QRCode from "qrcode";
import { RELEASE_VERSION } from "@/app/consent/version";
import {
  CHECKLIST,
  IDEA,
  MINOR,
  PEOPLE,
  QUEUE,
  QUEUE_EXTRAS,
  PEOPLE_ROWS,
  SAFETY_REPORTS,
  REVIEWER,
  STUDENT,
  SUBMISSIONS,
} from "../fixtures";

/**
 * Dev-only preview of every screen, rendered from fixtures so the UI can be
 * looked at (and screenshotted) without a Supabase project behind it. These are
 * the same view components the real pages use — not a parallel mock-up — so a
 * change to the app shows up here.
 */

const TASK_TEMPLATE = {
  title: "Hallway energy between classes", brief: "Stand in one safe place and capture the five minutes between bells.",
  campaign: "Fall semester", mediaType: "video" as const, orientation: "portrait" as const, minMediaCount: 1, maxMediaCount: 1,
  minDurationSeconds: 10, maxDurationSeconds: 30, captionRequired: true, guidelineSetIds: ["g1"], active: true,
};

export const dynamic = "force-dynamic";

// Screenshots must not drift every time the date changes.
const FIXED_DAY = new Date("2026-09-01T09:00:00Z");

const PROGRESS = {
  record: { streak: 4, sent: 11, posted: 3 },
  recent: { id: "p1", title: "Teach us one thing", postedAt: "2026-08-31T16:00:00Z", postUrl: "https://www.instagram.com/p/example/" },
  community: {
    weekPosted: 23,
    weekContributors: 41,
    groups: [{ name: "Varsity soccer", kind: "team", members: 18, weekSent: 14 }],
  },
  board: {
    optedIn: true,
    groups: [{
      name: "Varsity soccer",
      kind: "team",
      entries: [
        { firstName: "Jo", weekSent: 5, weekPosted: 2, me: false },
        { firstName: "Ali", weekSent: 4, weekPosted: 1, me: true },
        { firstName: "Sam", weekSent: 2, weekPosted: 0, me: false },
      ],
    }],
  },
};

const SCREENS = [
  "today",
  "today-done",
  "capture",
  "consent",
  "submissions",
  "review",
  "poster",
  "people",
  "tasks",
] as const;

export default async function PreviewScreen({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ url?: string; headline?: string; org?: string; note?: string; media?: string }>;
}) {
  if (!demoScreensEnabled()) notFound();
  const { screen } = await params;
  const { url: urlParam, headline, org, note, media } = await searchParams;

  switch (screen) {
    case "today":
      return (
        <TodayView
          person={STUDENT}
          assignment={{ id: "assignment-1", completed_at: null }}
          idea={IDEA}
          today={FIXED_DAY}
          progress={{ ...PROGRESS, recent: null }}
        />
      );

    case "today-done":
      return (
        <TodayView
          person={STUDENT}
          assignment={{ id: "assignment-1", completed_at: "2026-09-01T14:02:00Z" }}
          idea={IDEA}
          today={FIXED_DAY}
          progress={PROGRESS}
        />
      );

    case "capture":
      return (
        <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
          <CaptureFlow
            assignmentId="assignment-1"
            ideaId={IDEA.id}
            spec={IDEA.format_spec}
            mediaType={media === "photo" ? "photo_series" : IDEA.media_type}
            orientation={IDEA.orientation}
            minMediaCount={IDEA.min_media_count}
            maxMediaCount={media === "photo" ? 3 : IDEA.max_media_count}
            captionRequired={IDEA.caption_required}
            checklist={CHECKLIST}
            people={PEOPLE}
            self={{ id: STUDENT.id, display_name: STUDENT.display_name }}
            maxBytes={536_870_912}
            supabaseUrl="https://example.supabase.co"
          />
        </main>
      );

    case "consent":
      return (
        <ConsentView person={MINOR} minor ageUnknown={false} releaseVersion={RELEASE_VERSION}>
          {/* A matching name would try to write a consent row, which needs a database;
              a mismatch shows the guidance without one. */}
          <ConsentForm personId={MINOR.id} displayName={MINOR.display_name} />
        </ConsentView>
      );

    case "submissions":
      return <SubmissionsView person={STUDENT} rows={SUBMISSIONS} progress={PROGRESS} />;

    case "review":
      return (
        <main className="mx-auto max-w-6xl px-5 py-6">
          <ReviewQueue
            rows={QUEUE}
            tab="review"
            counts={{ review: 3, waiting: 1, ready: 2, posted: 14, rejected: 3 }}
            search=""
            extras={QUEUE_EXTRAS}
            safetyReports={SAFETY_REPORTS}
            mediaSrc="/preview-frame.svg"
          />
        </main>
      );

    case "people":
      return (
        <main className="mx-auto max-w-5xl px-5 py-8">
          <PeopleManager rows={PEOPLE_ROWS} releaseVersion={RELEASE_VERSION} today="2026-09-01" />
        </main>
      );

    case "dashboard": {
      const now = new Date("2026-09-01T19:30:00Z");
      const due = [0, 0, 18, 18, 18, 18, 18, 0, 0, 20, 20, 20, 20, 20];
      const sent = [0, 0, 11, 13, 12, 9, 14, 0, 0, 15, 16, 12, 17, 11];
      const upcoming = upcomingDays(
        daysAfter("2026-09-01", 7),
        new Map([["2026-09-02", 20], ["2026-09-03", 20], ["2026-09-04", 20], ["2026-09-08", 20]]),
      );
      return (
        <DashboardView
          person={{ ...REVIEWER, role: "admin", display_name: "Dana Reyes" }}
          today="2026-09-01"
          now={now}
          sentToday={{ due: 20, sent: 11 }}
          queue={{
            toReview: 7,
            oldestToReviewSince: "2026-09-01T15:10:00Z",
            waitingOnStudent: 2,
            readyToPost: 4,
            readyBlocked: 1,
            postedThisWeek: 23,
          }}
          attention={attentionItems({
            now,
            oldestScanQueuedAt: "2026-09-01T17:05:00Z",
            queuedScans: 3,
            safetyReports: 1,
            withdrawalRequests: 1,
            approvedBlockedByRelease: 1,
            studentsAwaitingActivation: 2,
            studentsNeedingParentRelease: 4,
            tasksWithNobodyAssigned: 1,
            nextGap: upcoming.find((d) => d.gap)?.date ?? null,
          })}
          participation={daysEnding("2026-09-01", 14).map((date, i) => ({ date, due: due[i]!, sent: sent[i]! }))}
          upcoming={upcoming}
          quiet={[
            { personId: "q1", name: "Sam Okafor", missed: 4, lastSentOn: "2026-08-21", email: "sam@example.edu" },
            { personId: "q2", name: "Jo Mercer", missed: 3, lastSentOn: null, email: "jo@example.edu" },
          ]}
        />
      );
    }

    case "tasks": {
      const names = ["Ava Kowalski", "Ben Ortiz", "Cam Nguyen", "Dani Reyes", "Eli Brooks", "Fay Mercer", "Gus Patel", "Hana Lee"];
      const students = names.map((name, i) => ({
        id: `7${i}000000-0000-0000-0000-000000000000`,
        display_name: name,
        email: `${name.split(" ")[0]!.toLowerCase()}@example.edu`,
        participation: i === 3 ? "pending" : "active",
      }));
      return (
        <main className="mx-auto max-w-5xl px-5 py-8">
          <TaskManager
            today="2026-09-01"
            campaigns={[{ id: "c1", name: "Fall semester", starts_on: "2026-08-20", ends_on: null }]}
            students={students}
            guidelineSets={[{ id: "g1", name: "Northside brand rules", kind: "brand" }]}
            guidelineText={{ g1: ["No alcohol, vaping, or gambling in frame.", "No grades, schedules, rosters, or ID cards visible."] }}
            groups={[{ id: "gr1", name: "Varsity soccer", kind: "team", memberIds: students.slice(0, 4).map((s) => s.id) }]}
            tasks={[{ ...TASK_TEMPLATE, id: "t1", assignmentCount: 20, dueCount: 12, sentCount: 9, firstDueOn: "2026-08-24", lastDueOn: "2026-09-04" }]}
          />
        </main>
      );
    }

    case "poster": {
      // Only ever encode a web address — a printed code must not be able to
      // carry a javascript: or data: payload.
      const url = safeUrl(urlParam) ?? "https://capture.example.edu";
      return (
        <PosterView
          orgName={org || "Orchard Lake St. Mary's"}
          headline={headline || "One clip. Every day."}
          url={url}
          note={note}
          qrSvg={await QRCode.toString(url, {
            type: "svg",
            margin: 0,
            errorCorrectionLevel: "M",
            color: { dark: "#17191a", light: "#ffffff" },
          })}
        />
      );
    }

    default:
      notFound();
  }
}

function safeUrl(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
