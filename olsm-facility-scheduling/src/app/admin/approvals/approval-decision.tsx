"use client";

import { useState } from "react";
import { approveAction } from "@/app/actions/booking-actions";
import { Button, inputClass } from "@/components/ui";

export function ApprovalDecision({ stepId }: { stepId: string }) {
  const [denying, setDenying] = useState(false);

  return (
    <form action={approveAction} className="space-y-3">
      <input type="hidden" name="stepId" value={stepId} />

      {denying && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-navy-800">
            Reason for denial (sent to the requester)
          </span>
          <textarea name="note" rows={2} required className={inputClass} />
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {!denying ? (
          <>
            <Button type="submit" name="decision" value="APPROVED">
              Approve
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDenying(true)}>
              Deny…
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value="DENIED" variant="danger">
              Confirm denial
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDenying(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
