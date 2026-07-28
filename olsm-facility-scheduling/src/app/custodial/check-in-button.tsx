"use client";

import { BookingStatus } from "@prisma/client";
import { checkInAction } from "@/app/actions/booking-actions";
import { Badge, Button } from "@/components/ui";

/**
 * Check-in from the setup board. Facilities staff are physically in the room,
 * so they are usually the ones who know whether a group actually turned up.
 */
export function CheckInButton({
  bookingId,
  status,
  startAt,
}: {
  bookingId: string;
  status: BookingStatus;
  startAt: string;
}) {
  if (status === BookingStatus.CHECKED_IN) return <Badge tone="good">Checked in</Badge>;
  if (status !== BookingStatus.CONFIRMED) return null;

  // Only offer it around the booking's own time.
  const start = new Date(startAt).getTime();
  if (Math.abs(Date.now() - start) > 12 * 3_600_000) return null;

  return (
    <form action={checkInAction}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" variant="secondary">
        Check in
      </Button>
    </form>
  );
}
