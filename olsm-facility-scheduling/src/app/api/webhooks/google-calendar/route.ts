import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueue } from "@/services/job-queue";

/**
 * Google Calendar push notification.
 *
 * Google sends a bare ping with no body, so the response must be fast: identify
 * the facility from the channel id and queue a reconcile. The reconcile is what
 * finds edits made in Google and writes ours back over them.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("x-goog-channel-token");
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceState = request.headers.get("x-goog-resource-state");

  // The token is a shared secret set when the channel was created.
  if (!env.google.calendarWebhookToken || token !== env.google.calendarWebhookToken) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  // "sync" is the handshake Google sends when a channel opens; nothing changed.
  if (resourceState === "sync") return new NextResponse(null, { status: 200 });

  if (!channelId) return NextResponse.json({ error: "Missing channel." }, { status: 400 });

  const facility = await prisma.facility.findFirst({ where: { googleChannelId: channelId } });
  if (!facility) {
    // A stale channel from a previous deployment. Acknowledge so Google stops.
    return new NextResponse(null, { status: 200 });
  }

  await enqueue({
    kind: "calendar.revert",
    payload: { facilityId: facility.id },
    // Collapse a burst of notifications into a single reconcile pass.
    idempotencyKey: `calendar:revert:${facility.id}`,
  });

  return new NextResponse(null, { status: 200 });
}
