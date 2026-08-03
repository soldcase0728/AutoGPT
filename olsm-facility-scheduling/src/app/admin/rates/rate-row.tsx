"use client";

import { useActionState } from "react";
import { updateRateAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, inputClass } from "@/components/ui";

const initial: AdminFormState = {};

export function RateRow({
  rate,
}: {
  rate: {
    id: string;
    hourlyCents: number;
    flatDayCents: number | null;
    minHours: number;
  };
}) {
  const [state, action, pending] = useActionState(updateRateAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="rateCardId" value={rate.id} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.notice && <Alert tone="success">{state.notice}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Money name="hourlyDollars" label="Hourly" cents={rate.hourlyCents} />
        <Money name="flatDayDollars" label="Full day cap" cents={rate.flatDayCents} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-navy-800">Minimum hours</span>
          <input
            type="number"
            name="minHours"
            step="0.5"
            min="0.5"
            max="24"
            defaultValue={rate.minHours}
            required
            className={inputClass}
          />
        </label>
      </div>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

function Money({ name, label, cents }: { name: string; label: string; cents: number | null }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-navy-800">{label}</span>
      <div className="flex items-center gap-1">
        <span aria-hidden className="text-navy-600">
          $
        </span>
        <input
          type="number"
          name={name}
          step="0.01"
          min="0"
          defaultValue={cents === null ? "" : (cents / 100).toFixed(2)}
          className={inputClass}
        />
      </div>
    </label>
  );
}
