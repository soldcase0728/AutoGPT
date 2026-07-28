"use client";

import { useActionState, useState } from "react";
import { publishSeasonAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button } from "@/components/ui";

const initial: AdminFormState = {};

export function PublishSeasonForm({ seasonId, published }: { seasonId: string; published: boolean }) {
  const [state, action, pending] = useActionState(publishSeasonAction, initial);
  const [confirming, setConfirming] = useState(false);

  if (state.notice) return <Alert tone="success">{state.notice}</Alert>;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="seasonId" value={seasonId} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      {published && (
        <Alert tone="warn">
          This season is already published. Publishing again creates bookings for any blocks added
          since, and skips occurrences that already exist.
        </Alert>
      )}

      {!confirming ? (
        <Button type="button" onClick={() => setConfirming(true)}>
          Publish season…
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-navy-700">
            This creates a confirmed booking for every session and writes them to the facility
            calendars. Coaches can release individual days afterwards.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Publishing…" : "Yes, publish"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
