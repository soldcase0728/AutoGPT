"use client";

import { useActionState, useState } from "react";
import { updateSubSpaceBlocksAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button } from "@/components/ui";

const initial: AdminFormState = {};

export function ConflictGraphEditor({
  subSpace,
  candidates,
}: {
  subSpace: { id: string; name: string; blocksIds: string[] };
  candidates: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(updateSubSpaceBlocksAction, initial);
  const [open, setOpen] = useState(false);

  const currentLabels = candidates
    .filter((c) => subSpace.blocksIds.includes(c.id))
    .map((c) => c.label);

  return (
    <div className="rounded border border-navy-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-navy-900">{subSpace.name}</p>
          <p className="text-sm text-navy-600">
            {currentLabels.length === 0
              ? "Independent — booking it closes nothing else."
              : `Booking it also closes: ${currentLabels.join(", ")}`}
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Edit"}
        </Button>
      </div>

      {open && (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="subSpaceId" value={subSpace.id} />
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.notice && <Alert tone="success">{state.notice}</Alert>}

          <fieldset className="max-h-64 space-y-1 overflow-y-auto rounded border border-navy-200 p-2">
            <legend className="sr-only">Spaces closed by booking {subSpace.name}</legend>
            {candidates.map((candidate) => (
              <label key={candidate.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="blocksIds"
                  value={candidate.id}
                  defaultChecked={subSpace.blocksIds.includes(candidate.id)}
                  className="rounded border-navy-400"
                />
                {candidate.label}
              </label>
            ))}
          </fieldset>

          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Saving…" : "Save conflict rules"}
          </Button>
        </form>
      )}
    </div>
  );
}
