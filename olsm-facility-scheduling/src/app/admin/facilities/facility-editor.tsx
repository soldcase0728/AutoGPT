"use client";

import { useActionState } from "react";
import { updateFacilityAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const initial: AdminFormState = {};

export function FacilityEditor({
  facility,
}: {
  facility: {
    id: string;
    name: string;
    capacity: number;
    bufferMinutes: number;
    externallyBookable: boolean;
    requiresSupervision: boolean;
    description: string | null;
    active: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateFacilityAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="facilityId" value={facility.id} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.notice && <Alert tone="success">{state.notice}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor={`name-${facility.id}`}>
          <input
            id={`name-${facility.id}`}
            name="name"
            defaultValue={facility.name}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Capacity" htmlFor={`capacity-${facility.id}`}>
          <input
            id={`capacity-${facility.id}`}
            name="capacity"
            type="number"
            min={1}
            defaultValue={facility.capacity}
            className={inputClass}
          />
        </Field>
        <Field
          label="Setup / teardown buffer (minutes)"
          htmlFor={`buffer-${facility.id}`}
          hint="Reserved either side of every booking."
        >
          <input
            id={`buffer-${facility.id}`}
            name="bufferMinutes"
            type="number"
            min={0}
            max={240}
            defaultValue={facility.bufferMinutes}
            className={inputClass}
          />
        </Field>
      </div>


      <Field label="Public description" htmlFor={`desc-${facility.id}`}>
        <textarea
          id={`desc-${facility.id}`}
          name="description"
          rows={2}
          defaultValue={facility.description ?? ""}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="externallyBookable"
            defaultChecked={facility.externallyBookable}
            className="rounded border-navy-400"
          />
          Outside groups may request it
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="requiresSupervision"
            defaultChecked={facility.requiresSupervision}
            className="rounded border-navy-400"
          />
          Requires a named supervisor
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="active"
            defaultChecked={facility.active}
            className="rounded border-navy-400"
          />
          Active
        </label>
      </div>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save facility"}
      </Button>
    </form>
  );
}
