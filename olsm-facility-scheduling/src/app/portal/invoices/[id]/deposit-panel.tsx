"use client";

import { useActionState, useState } from "react";
import {
  captureDepositAction,
  releaseDepositAction,
  type AdminFormState,
} from "@/app/actions/admin-actions";
import { Alert, Badge, Button, Field, inputClass } from "@/components/ui";

const initial: AdminFormState = {};

export interface DepositView {
  state: "none" | "pending" | "held" | "released" | "captured";
  amountFormatted: string;
  amountDollars: number;
  capturedFormatted: string;
  awaitingResolution: boolean;
  captureReason: string | null;
}

/**
 * Admin-only. A renter sees their deposit on the invoice; only the athletic
 * office decides what happens to it, and capturing always needs a reason.
 */
export function DepositPanel({
  invoiceId,
  deposit,
}: {
  invoiceId: string;
  deposit: DepositView;
}) {
  const [releaseState, releaseAction, releasing] = useActionState(releaseDepositAction, initial);
  const [captureState, captureAction, capturing] = useActionState(captureDepositAction, initial);
  const [keeping, setKeeping] = useState(false);

  if (deposit.state === "none") return null;

  if (deposit.state === "released") {
    return (
      <Alert tone="success" title="Deposit released">
        The {deposit.amountFormatted} hold was released without charge.
      </Alert>
    );
  }

  if (deposit.state === "captured") {
    return (
      <Alert tone="warn" title={`${deposit.capturedFormatted} retained`}>
        <p>Of the {deposit.amountFormatted} authorised, {deposit.capturedFormatted} was captured.</p>
        {deposit.captureReason && <p className="mt-1 italic">“{deposit.captureReason}”</p>}
      </Alert>
    );
  }

  if (deposit.state === "pending") {
    return (
      <Alert tone="info" title="Deposit not yet authorised">
        A {deposit.amountFormatted} hold is due on this rental. It is placed once a payment method
        is on file.
      </Alert>
    );
  }

  const notice = releaseState.notice ?? captureState.notice;
  if (notice) return <Alert tone="success">{notice}</Alert>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={deposit.awaitingResolution ? "warn" : "neutral"}>
          {deposit.amountFormatted} held
        </Badge>
        {deposit.awaitingResolution && (
          <span className="text-xs text-gold-900">
            The rental is over — resolve this before the authorisation lapses.
          </span>
        )}
      </div>

      {releaseState.error && <Alert tone="danger">{releaseState.error}</Alert>}
      {captureState.error && <Alert tone="danger">{captureState.error}</Alert>}

      {!keeping ? (
        <div className="flex flex-wrap gap-2">
          <form action={releaseAction}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <Button type="submit" disabled={releasing}>
              {releasing ? "Releasing…" : "Release in full"}
            </Button>
          </form>
          <Button type="button" variant="secondary" onClick={() => setKeeping(true)}>
            Keep some of it…
          </Button>
        </div>
      ) : (
        <form action={captureAction} className="space-y-3 rounded border border-navy-200 p-3">
          <input type="hidden" name="invoiceId" value={invoiceId} />

          <Field label="Amount to keep" htmlFor="amountDollars">
            <div className="flex items-center gap-1">
              <span aria-hidden className="text-navy-600">
                $
              </span>
              <input
                id="amountDollars"
                name="amountDollars"
                type="number"
                step="0.01"
                min="0.01"
                max={deposit.amountDollars}
                required
                className={inputClass}
              />
            </div>
          </Field>

          <Field
            label="Why"
            htmlFor="reason"
            hint="Sent to the renter verbatim and recorded in the audit log. Be specific."
          >
            <textarea
              id="reason"
              name="reason"
              rows={2}
              required
              minLength={10}
              placeholder="Two damaged wall pads; replacement quoted at $180."
              className={inputClass}
            />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={capturing}>
              {capturing ? "Capturing…" : "Capture and release the rest"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setKeeping(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
