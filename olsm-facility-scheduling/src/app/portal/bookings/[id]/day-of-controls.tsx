"use client";

import { useState } from "react";
import { BookingStatus } from "@prisma/client";
import { checkInAction, markNoShowAction } from "@/app/actions/booking-actions";
import { Button, Card } from "@/components/ui";

/**
 * Day-of operations. Hidden until the booking is close enough to matter --
 * a check-in button on a booking three weeks out is noise, and a no-show
 * marked in advance is meaningless.
 */
const VISIBLE_WINDOW_MS = 24 * 3_600_000;

export function DayOfControls({
  bookingId,
  status,
  startAt,
  canCheckIn,
  canMarkNoShow,
}: {
  bookingId: string;
  status: BookingStatus;
  startAt: string;
  canCheckIn: boolean;
  canMarkNoShow: boolean;
}) {
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);

  const start = new Date(startAt).getTime();
  const withinWindow = Math.abs(Date.now() - start) <= VISIBLE_WINDOW_MS;

  if (status === BookingStatus.CHECKED_IN) {
    return (
      <Card title="Day of">
        <p className="text-sm text-emerald-900">Checked in. The space is in use.</p>
      </Card>
    );
  }

  if (status !== BookingStatus.CONFIRMED || !withinWindow) return null;
  if (!canCheckIn && !canMarkNoShow) return null;

  return (
    <Card title="Day of">
      <p className="mb-3 text-sm text-navy-700">
        Checking in records that the space was actually used. Unclaimed bookings show up in the
        no-show report, which is how the athletic office finds recurring waste.
      </p>

      <div className="space-y-2">
        {canCheckIn && (
          <form action={checkInAction}>
            <input type="hidden" name="bookingId" value={bookingId} />
            <Button type="submit" className="w-full">
              Check in
            </Button>
          </form>
        )}

        {canMarkNoShow &&
          (confirmingNoShow ? (
            <form action={markNoShowAction} className="space-y-2">
              <input type="hidden" name="bookingId" value={bookingId} />
              <p className="text-sm text-navy-700">
                This releases the space and records a no-show against the requester.
              </p>
              <div className="flex gap-2">
                <Button type="submit" variant="danger">
                  Confirm no-show
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmingNoShow(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => setConfirmingNoShow(true)}
            >
              Mark as a no-show…
            </Button>
          ))}
      </div>
    </Card>
  );
}
