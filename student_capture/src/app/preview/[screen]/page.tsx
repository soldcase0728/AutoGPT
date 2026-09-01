import { notFound } from "next/navigation";
import { demoScreensEnabled } from "@/lib/demo";
import { TodayView } from "@/components/views/TodayView";
import { SubmissionsView } from "@/components/views/SubmissionsView";
import { ConsentView } from "@/components/views/ConsentView";
import { CaptureFlow } from "@/app/capture/[assignmentId]/CaptureFlow";
import { ReviewQueue } from "@/app/review/ReviewQueue";
import { PosterView } from "@/components/views/PosterView";
import QRCode from "qrcode";
import { RELEASE_VERSION } from "@/app/consent/version";
import {
  CHECKLIST,
  IDEA,
  MINOR,
  PEOPLE,
  QUEUE,
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

export const dynamic = "force-dynamic";

// Screenshots must not drift every time the date changes.
const FIXED_DAY = new Date("2026-09-01T09:00:00Z");

const SCREENS = [
  "today",
  "today-done",
  "capture",
  "consent",
  "submissions",
  "review",
  "poster",
] as const;

export default async function PreviewScreen({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<{ url?: string; headline?: string; org?: string; note?: string }>;
}) {
  if (!demoScreensEnabled()) notFound();
  const { screen } = await params;
  const { url: urlParam, headline, org, note } = await searchParams;

  switch (screen) {
    case "today":
      return (
        <TodayView
          person={STUDENT}
          assignment={{ id: "assignment-1", completed_at: null }}
          idea={IDEA}
          checklist={CHECKLIST}
          today={FIXED_DAY}
        />
      );

    case "today-done":
      return (
        <TodayView
          person={STUDENT}
          assignment={{ id: "assignment-1", completed_at: "2026-09-01T14:02:00Z" }}
          idea={IDEA}
          checklist={CHECKLIST}
          today={FIXED_DAY}
        />
      );

    case "capture":
      return (
        <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
          <CaptureFlow
            assignmentId="assignment-1"
            ideaId={IDEA.id}
            spec={IDEA.format_spec}
            mediaType={IDEA.media_type}
            orientation={IDEA.orientation}
            minMediaCount={IDEA.min_media_count}
            maxMediaCount={IDEA.max_media_count}
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
          <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
            The signing form is omitted here — it writes a consent row, which needs a
            database.
          </p>
        </ConsentView>
      );

    case "submissions":
      return <SubmissionsView person={STUDENT} rows={SUBMISSIONS} />;

    case "review":
      return (
        <main className="mx-auto max-w-6xl px-5 py-6">
          <ReviewQueue rows={QUEUE} filter="open" mediaSrc="/preview-frame.svg" />
        </main>
      );

    case "poster": {
      // Only ever encode a web address — a printed code must not be able to
      // carry a javascript: or data: payload.
      const url = safeUrl(urlParam) ?? "https://capture.example.edu";
      return (
        <PosterView
          orgName={org || "Northside Athletics"}
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
