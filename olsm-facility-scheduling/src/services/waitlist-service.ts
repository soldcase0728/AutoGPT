/**
 * Waitlist. When a coach releases a standing block, or a hold expires, the time
 * returns to open inventory and whoever asked for that window gets told.
 */

import type { ActivityType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatRange } from "@/lib/time";
import { indexSubSpaces, occupiedSubSpaceIds, type SubSpaceNode } from "@/domain/conflict-graph";
import { overlaps } from "@/lib/time";
import { enqueue } from "./job-queue";
import { recordAudit } from "@/lib/audit";

export async function joinWaitlist(params: {
  subSpaceId: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  activityType: ActivityType;
}) {
  return prisma.waitlistEntry.create({ data: params });
}

/**
 * Notify everyone whose requested window overlaps freed time. Matching goes
 * through the conflict graph so releasing "Full floor" notifies people waiting
 * on Court A.
 */
export async function notifyWaitlistForWindow(
  subSpaceId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const allSubSpaces = await prisma.subSpace.findMany({ where: { active: true } });
  const index = indexSubSpaces(allSubSpaces as SubSpaceNode[]);
  const freed = occupiedSubSpaceIds(subSpaceId, index);

  const candidates = await prisma.waitlistEntry.findMany({
    where: {
      subSpaceId: { in: freed },
      fulfilledAt: null,
      notifiedAt: null,
      windowStart: { lt: end },
      windowEnd: { gt: start },
    },
    include: { user: true, subSpace: { include: { facility: true } } },
    orderBy: { createdAt: "asc" },
  });

  let notified = 0;

  for (const entry of candidates) {
    if (!overlaps(entry.windowStart, entry.windowEnd, start, end)) continue;

    await enqueue({
      kind: "notify.email",
      payload: {
        to: entry.user.email,
        subject: `${entry.subSpace.facility.name} is now open on ${formatRange(start, end)}`,
        text:
          `${entry.user.name},\n\n` +
          `Time you asked about has been released: ${entry.subSpace.facility.name} — ` +
          `${entry.subSpace.name}, ${formatRange(start, end)}.\n\n` +
          `It is first come, first served: ${env.appUrl}/book?subSpace=${entry.subSpaceId}\n`,
      },
      idempotencyKey: `waitlist:${entry.id}:${start.toISOString()}`,
    });

    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: { notifiedAt: new Date() },
    });

    notified += 1;
  }

  if (notified > 0) {
    await recordAudit({
      entityType: "booking",
      entityId: subSpaceId,
      action: "waitlist.notified",
      actorLabel: "system",
      payload: { notified, windowStart: start.toISOString(), windowEnd: end.toISOString() },
    });
  }

  return notified;
}

export async function leaveWaitlist(entryId: string, userId: string): Promise<void> {
  await prisma.waitlistEntry.deleteMany({ where: { id: entryId, userId } });
}
