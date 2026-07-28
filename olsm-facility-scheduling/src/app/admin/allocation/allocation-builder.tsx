"use client";

import { useActionState } from "react";
import { TeamLevel } from "@prisma/client";
import { addStandingBlockAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const DAYS = [
  { value: "MO", label: "Mon" },
  { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" },
  { value: "TH", label: "Thu" },
  { value: "FR", label: "Fri" },
  { value: "SA", label: "Sat" },
  { value: "SU", label: "Sun" },
];

const initial: AdminFormState = {};

export function AllocationBuilder({
  seasonId,
  sports,
  spaces,
  coaches,
}: {
  seasonId: string;
  sports: { id: string; name: string }[];
  spaces: { id: string; label: string }[];
  coaches: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(addStandingBlockAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="seasonId" value={seasonId} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.notice && <Alert tone="success">{state.notice}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sport" htmlFor="sportId">
          <select id="sportId" name="sportId" required className={inputClass}>
            {sports.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Team level" htmlFor="teamLevel" hint="Varsity outranks JV when both want the same space.">
          <select id="teamLevel" name="teamLevel" defaultValue={TeamLevel.VARSITY} className={inputClass}>
            {Object.values(TeamLevel).map((level) => (
              <option key={level} value={level}>
                {level.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Space" htmlFor="subSpaceId">
          <select id="subSpaceId" name="subSpaceId" required className={inputClass}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Owning coach"
          htmlFor="createdById"
          hint="The generated bookings are made in this coach's name, and they can release days they do not need."
        >
          <select id="createdById" name="createdById" required className={inputClass}>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-navy-800">Days</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((day) => (
            <label key={day.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="days"
                value={day.value}
                defaultChecked={["MO", "TU", "WE", "TH", "FR"].includes(day.value)}
                className="rounded border-navy-400"
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Start time" htmlFor="startTime">
          <input id="startTime" name="startTime" type="time" required defaultValue="15:30" className={inputClass} />
        </Field>
        <Field label="End time" htmlFor="endTime">
          <input id="endTime" name="endTime" type="time" required defaultValue="17:30" className={inputClass} />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add standing block"}
      </Button>
    </form>
  );
}
