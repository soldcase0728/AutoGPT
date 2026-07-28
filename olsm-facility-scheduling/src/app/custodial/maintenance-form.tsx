"use client";

import { useActionState } from "react";
import { createBlackoutAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const initial: AdminFormState = {};

export function MaintenanceForm({ facilities }: { facilities: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createBlackoutAction, initial);

  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.notice && <Alert tone="success">{state.notice}</Alert>}

      <Field label="Facility" htmlFor="facilityId">
        <select id="facilityId" name="facilityId" required className={inputClass}>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Reason" htmlFor="reason">
        <input
          id="reason"
          name="reason"
          required
          placeholder="Floor refinishing"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From date" htmlFor="startDate">
          <input id="startDate" name="startDate" type="date" required className={inputClass} />
        </Field>
        <Field label="From time" htmlFor="startTime">
          <input id="startTime" name="startTime" type="time" required defaultValue="06:00" className={inputClass} />
        </Field>
        <Field label="To date" htmlFor="endDate">
          <input id="endDate" name="endDate" type="date" required className={inputClass} />
        </Field>
        <Field label="To time" htmlFor="endTime">
          <input id="endTime" name="endTime" type="time" required defaultValue="22:00" className={inputClass} />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Mark unavailable"}
      </Button>
    </form>
  );
}
