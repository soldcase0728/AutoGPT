"use client";

import { useState } from "react";
import { releaseBlockAction } from "@/app/actions/booking-actions";
import { Button } from "@/components/ui";

/**
 * One click to give a day back. Confirmation is inline rather than a
 * window.confirm so it reads on a phone, which is where coaches will use it.
 */
export function ReleaseButton({ bookingId, label }: { bookingId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
        Release this day
      </Button>
    );
  }

  return (
    <form action={releaseBlockAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <span className="text-sm text-navy-700">Give up {label}?</span>
      <Button type="submit" variant="danger">
        Yes, release it
      </Button>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </form>
  );
}
