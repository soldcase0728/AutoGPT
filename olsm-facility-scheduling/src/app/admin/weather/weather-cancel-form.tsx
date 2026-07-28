"use client";

import { useActionState, useState } from "react";
import { cancelForWeatherAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const initial: AdminFormState = {};

const PRESETS = [
  "Lightning in the area",
  "Unplayable field conditions",
  "Severe weather warning",
  "Extreme heat",
];

export function WeatherCancelForm({
  facilityId,
  facilityName,
  dateISO,
  count,
}: {
  facilityId: string;
  facilityName: string;
  dateISO: string;
  count: number;
}) {
  const [state, action, pending] = useActionState(cancelForWeatherAction, initial);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState(PRESETS[0]);

  if (state.notice) return <Alert tone="success">{state.notice}</Alert>;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="date" value={dateISO} />

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <Field
        label="Conditions"
        htmlFor="reason"
        hint="This exact wording is sent to every organiser by email and text."
      >
        <input
          id="reason"
          name="reason"
          required
          minLength={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setReason(preset)}
            className="rounded-full border border-navy-300 px-3 py-1 text-xs text-navy-700 hover:bg-navy-50"
          >
            {preset}
          </button>
        ))}
      </div>

      {/* Typed confirmation: this is bulk, irreversible and time-pressured. */}
      <Field
        label={`Type CANCEL to close ${facilityName} for ${dateISO}`}
        htmlFor="confirm"
        hint={`${count} booking${count === 1 ? "" : "s"} will be cancelled and refunded.`}
      >
        <input
          id="confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="CANCEL"
          className={inputClass}
        />
      </Field>

      <Button type="submit" variant="danger" disabled={pending || confirmText !== "CANCEL"}>
        {pending ? "Cancelling…" : `Cancel ${count} booking${count === 1 ? "" : "s"} for weather`}
      </Button>
    </form>
  );
}
