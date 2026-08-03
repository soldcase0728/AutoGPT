import { NextResponse } from "next/server";
import { buildIcsFeed } from "@/services/ical-feed";

/**
 * Read-only iCal feed per facility, for people who are not on Google Workspace
 * and for the public website. Confirmed bookings only, and no requester
 * contact details -- this URL is unauthenticated by design.
 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const facilitySlug = slug.replace(/\.ics$/i, "");

  const ics = await buildIcsFeed(facilitySlug);
  if (!ics) return NextResponse.json({ error: "Unknown facility." }, { status: 404 });

  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${facilitySlug}.ics"`,
      // Calendar clients poll hard; an hour is plenty fresh for a schedule.
      "cache-control": "public, max-age=3600",
    },
  });
}
