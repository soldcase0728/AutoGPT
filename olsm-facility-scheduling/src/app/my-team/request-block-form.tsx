"use client";

import { useActionState } from "react";
import Link from "next/link";
import { TeamLevel } from "@prisma/client";
import {
  requestStandingBlockAction,
  type StandingBlockFormState,
} from "@/app/actions/booking-actions";
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

const initial: StandingBlockFormState = {};

export function RequestBlockForm({
  seasons,
  sports,
  spaces,
}: {
  seasons: { id: string; label: string }[];
  sports: { id: string; name: string }[];
  spaces: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(requestStandingBlockAction, initial);

  return (
    <form action={action} className="space-y-3">
      {state.error && (
        <Alert tone="danger" title="That request did not go through">
          <p>{state.error}</p>
          {state.action && (
            <p className="mt-2">
              <Link href={state.action.href} className="font-medium underline">
                {state.action.label}
              </Link>
            </p>
          )}
        </Alert>
      )}
      {state.notice && (
        <Alert tone="success" title="Requested">
          <p>{state.notice}</p>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Season" htmlFor="request-seasonId">
          <select id="request-seasonId" name="seasonId" required className={inputClass}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sport" htmlFor="request-sportId">
          <select id="request-sportId" name="sportId" required className={inputClass}>
            {sports.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Team level"
          htmlFor="request-teamLevel"
          hint="Varsity outranks JV when both want the same space."
        >
          <select
            id="request-teamLevel"
            name="teamLevel"
            defaultValue={TeamLevel.VARSITY}
            className={inputClass}
          >
            {Object.values(TeamLevel).map((level) => (
              <option key={level} value={level}>
                {level.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Space" htmlFor="request-subSpaceId">
          <select id="request-subSpaceId" name="subSpaceId" required className={inputClass}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
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
        <Field label="Start time" htmlFor="request-startTime">
          <input
            id="request-startTime"
            name="startTime"
            type="time"
            required
            defaultValue="15:30"
            className={inputClass}
          />
        </Field>
        <Field label="End time" htmlFor="request-endTime">
          <input
            id="request-endTime"
            name="endTime"
            type="time"
            required
            defaultValue="17:30"
            className={inputClass}
          />
        </Field>

        <Field
          label="First practice date"
          htmlFor="request-startDate"
          hint="Leave blank to start when the season starts."
        >
          <input id="request-startDate" name="startDate" type="date" className={inputClass} />
        </Field>
        <Field
          label="Last practice date"
          htmlFor="request-endDate"
          hint="Leave blank to run to the end of the season."
        >
          <input id="request-endDate" name="endDate" type="date" className={inputClass} />
        </Field>
      </div>

      <Field
        label="Note for the athletic office"
        htmlFor="request-note"
        hint="Anything that helps the review — shared-space arrangements, tournament dates, why this window."
      >
        <textarea id="request-note" name="note" rows={2} maxLength={2000} className={inputClass} />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Request standing time"}
      </Button>
    </form>
  );
}
