"use client";

import { useActionState, useState } from "react";
import { reviewCoiAction, type DocumentFormState } from "@/app/actions/document-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const initial: DocumentFormState = {};

/**
 * Accept or reject an uploaded certificate.
 *
 * Rejecting reveals a required reason, because the renter is shown it word for
 * word. "Invalid document" tells them nothing and buys a second wrong upload;
 * the placeholder is a worked example of a reason that can be acted on. The
 * server requires it too -- this is the prompt, not the enforcement.
 */
export function CoiReviewForm({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(reviewCoiAction, initial);
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED" | null>(null);

  if (state.notice) {
    return <Alert tone="success">{state.notice}</Alert>;
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="decision" value={decision ?? ""} />

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <p className="text-sm text-navy-700">
        Open the certificate and check the coverage and the additional-insured wording before
        accepting. Accepting records that you judged the limits adequate — the system checks only
        that a certificate exists and covers the event date.
      </p>

      {decision === "REJECTED" && (
        <>
          <Field
            label="Reason for rejecting"
            htmlFor="reason"
            hint="Shown to the renter exactly as written. Say what is wrong and what to send instead."
          >
            <textarea
              id="reason"
              name="reason"
              rows={3}
              required
              defaultValue=""
              placeholder="The certificate does not list Orchard Lake Schools as an additional insured. Upload a corrected certificate showing the required additional-insured wording."
              className={inputClass}
            />
          </Field>

          <Field label="Internal note" htmlFor="internalNote" hint="Staff only. Not shown to the renter.">
            <input id="internalNote" name="internalNote" className={inputClass} />
          </Field>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {decision !== "REJECTED" ? (
          <>
            <Button type="submit" disabled={pending} onClick={() => setDecision("ACCEPTED")}>
              {pending ? "Recording…" : "Accept certificate"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDecision("REJECTED")}>
              Reject…
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" disabled={pending}>
              {pending ? "Recording…" : "Reject and send the reason"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDecision(null)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
