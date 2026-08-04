"use client";

import { useState } from "react";
import { withdrawStandingBlockAction } from "@/app/actions/booking-actions";
import { Button } from "@/components/ui";

/**
 * Take back a request the athletic office has not decided yet. Inline
 * confirmation rather than window.confirm, same as releasing a day: it reads
 * on a phone.
 */
export function WithdrawButton({ blockId }: { blockId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        Withdraw
      </Button>
    );
  }

  return (
    <form action={withdrawStandingBlockAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="blockId" value={blockId} />
      <span className="text-sm text-navy-700">Withdraw this request?</span>
      <Button type="submit" variant="danger">
        Yes, withdraw
      </Button>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </form>
  );
}
