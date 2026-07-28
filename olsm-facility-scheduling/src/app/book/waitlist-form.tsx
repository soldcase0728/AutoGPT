"use client";

import { useState } from "react";
import { ActivityType } from "@prisma/client";
import { joinWaitlistAction } from "@/app/actions/booking-actions";
import { Button, Field, inputClass } from "@/components/ui";

/**
 * The other half of "release a block you don't need". Releasing only recovers
 * gym time if somebody is told, and somebody is only told if they asked.
 */
export function WaitlistForm({
  spaces,
  defaultDate,
  activities,
}: {
  spaces: { id: string; label: string }[];
  defaultDate: string;
  activities: { value: ActivityType; label: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Ask to be told if a slot opens
      </Button>
    );
  }

  return (
    <form action={joinWaitlistAction} className="space-y-3">
      <p className="text-sm text-navy-700">
        If a coach releases this window, or a hold expires on it, you get an email. It is first come,
        first served — the notice is not a reservation.
      </p>

      <Field label="Space" htmlFor="wl-subSpaceId">
        <select id="wl-subSpaceId" name="subSpaceId" required className={inputClass}>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="wl-date">
          <input id="wl-date" name="date" type="date" required defaultValue={defaultDate} className={inputClass} />
        </Field>
        <Field label="From" htmlFor="wl-start">
          <input id="wl-start" name="startTime" type="time" required defaultValue="15:30" className={inputClass} />
        </Field>
        <Field label="To" htmlFor="wl-end">
          <input id="wl-end" name="endTime" type="time" required defaultValue="17:30" className={inputClass} />
        </Field>
      </div>

      <Field label="What for" htmlFor="wl-activity">
        <select id="wl-activity" name="activityType" required className={inputClass}>
          {activities.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-2">
        <Button type="submit">Add me to the waitlist</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
