"use client";

import { useState } from "react";
import { cancelBookingAction } from "@/app/actions/booking-actions";
import { Button, inputClass } from "@/components/ui";

export function CancelBookingForm({
  bookingId,
  canWaivePolicy,
}: {
  bookingId: string;
  canWaivePolicy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
        Cancel booking…
      </Button>
    );
  }

  return (
    <form action={cancelBookingAction} className="space-y-3">
      <input type="hidden" name="bookingId" value={bookingId} />

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-navy-800">Reason</span>
        <textarea name="reason" rows={2} required className={inputClass} />
      </label>

      {canWaivePolicy && (
        <label className="flex items-start gap-2 text-sm text-navy-700">
          <input type="checkbox" name="waivePolicy" className="mt-0.5 rounded border-navy-400" />
          <span>
            Refund in full regardless of the cancellation window — use for weather cancellations and
            school-initiated changes. The waiver is recorded in the audit log.
          </span>
        </label>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="danger">
          Cancel booking
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
