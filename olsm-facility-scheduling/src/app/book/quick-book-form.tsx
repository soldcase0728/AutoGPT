"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ActivityType, TeamLevel } from "@prisma/client";
import { createBookingAction, type BookingFormState } from "@/app/actions/booking-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

export interface SpaceOption {
  id: string;
  label: string;
  facilityName: string;
  capacity: number;
  requiresSupervision: boolean;
}

export interface BookOption {
  value: ActivityType;
  label: string;
  description: string;
}

const initial: BookingFormState = {};

/**
 * Target: a head coach books an in-season practice in under 30 seconds. Every
 * field below the fold is optional, and the defaults are the coach's own sport,
 * today's date and a two-hour block.
 */
export function QuickBookForm({
  spaces,
  activities,
  sports,
  supervisors,
  defaultDate,
  defaultSubSpaceId,
  defaultSportId,
  defaultTeamLevel,
  isAdmin,
}: {
  spaces: SpaceOption[];
  activities: BookOption[];
  sports: { id: string; name: string }[];
  supervisors: { id: string; name: string; role: string }[];
  defaultDate: string;
  defaultSubSpaceId?: string;
  defaultSportId?: string;
  defaultTeamLevel?: TeamLevel;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(createBookingAction, initial);
  const [activityType, setActivityType] = useState<ActivityType>(
    activities.find((a) => a.value === ActivityType.TEAM_PRACTICE)?.value ?? activities[0]?.value,
  );
  const [subSpaceId, setSubSpaceId] = useState(defaultSubSpaceId ?? spaces[0]?.id ?? "");
  const [showDetails, setShowDetails] = useState(false);

  const selectedSpace = spaces.find((s) => s.id === subSpaceId);
  const selectedActivity = activities.find((a) => a.value === activityType);
  const isTeamActivity =
    activityType === ActivityType.TEAM_PRACTICE ||
    activityType === ActivityType.CONTEST ||
    activityType === ActivityType.TEAM_OFFSEASON;

  return (
    <form action={action} className="space-y-4">
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
          {state.bumpable && state.bumpable.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">This request outranks:</p>
              <ul className="mt-1 list-inside list-disc">
                {state.bumpable.map((b) => (
                  <li key={b.reference}>
                    {b.title} ({b.requesterName}, {b.reference})
                  </li>
                ))}
              </ul>
              {isAdmin && (
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <input type="checkbox" name="confirmBump" className="rounded border-navy-400" />
                  Bump these bookings. They will be cancelled, refunded in full and notified.
                </label>
              )}
            </div>
          )}
        </Alert>
      )}

      {state.notice && (
        <Alert tone="success" title="Booked">
          <p>{state.notice}</p>
          {state.warnings && state.warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc">
              {state.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 flex gap-3">
            {state.bookingId && (
              <Link href={`/portal/bookings/${state.bookingId}`} className="font-medium underline">
                View booking
              </Link>
            )}
            {state.invoiceId && (
              <Link href={`/portal/invoices/${state.invoiceId}`} className="font-medium underline">
                Pay invoice
              </Link>
            )}
          </p>
        </Alert>
      )}

      <Field label="Activity type" htmlFor="activityType" hint={selectedActivity?.description}>
        <select
          id="activityType"
          name="activityType"
          required
          className={inputClass}
          value={activityType}
          onChange={(e) => setActivityType(e.target.value as ActivityType)}
        >
          {activities.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>

      {activityType === ActivityType.PRIVATE_INSTRUCTION && (
        <Alert tone="warn" title="Paid instruction is billable, whoever is asking">
          Private lessons and personal training on school property require a signed facility use
          agreement, a per-booking waiver, a current certificate of insurance and payment at the
          commercial rate — including when the instructor is an OLSM coach.
        </Alert>
      )}

      <Field label="Space" htmlFor="subSpaceId" hint={selectedSpace ? `Capacity ${selectedSpace.capacity}` : undefined}>
        <select
          id="subSpaceId"
          name="subSpaceId"
          required
          className={inputClass}
          value={subSpaceId}
          onChange={(e) => setSubSpaceId(e.target.value)}
        >
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Title" htmlFor="title">
        <input
          id="title"
          name="title"
          required
          minLength={3}
          placeholder="Boys Basketball practice"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="date">
          <input id="date" name="date" type="date" required defaultValue={defaultDate} className={inputClass} />
        </Field>
        <Field label="Start" htmlFor="startTime">
          <input id="startTime" name="startTime" type="time" required defaultValue="15:30" className={inputClass} />
        </Field>
        <Field label="End" htmlFor="endTime">
          <input id="endTime" name="endTime" type="time" required defaultValue="17:30" className={inputClass} />
        </Field>
      </div>

      {isTeamActivity && sports.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sport" htmlFor="sportId">
            <select id="sportId" name="sportId" defaultValue={defaultSportId} className={inputClass}>
              <option value="">—</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Team level" htmlFor="teamLevel" hint="Varsity outranks JV when two teams want the same space.">
            <select id="teamLevel" name="teamLevel" defaultValue={defaultTeamLevel ?? TeamLevel.VARSITY} className={inputClass}>
              {Object.values(TeamLevel).map((level) => (
                <option key={level} value={level}>
                  {level.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {selectedSpace?.requiresSupervision && (
        <Field
          label="Supervising staff member"
          htmlFor="supervisorId"
          hint="This space requires a supervision-qualified staff member to be named on the booking."
        >
          <select id="supervisorId" name="supervisorId" required className={inputClass}>
            <option value="">Choose a supervisor…</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-sm font-medium text-navy-700 underline"
          aria-expanded={showDetails}
        >
          {showDetails ? "Hide" : "Add"} headcount, setup and equipment notes
        </button>
      </div>

      {showDetails && (
        <div className="space-y-3 rounded-md border border-navy-200 bg-navy-50 p-3">
          <Field label="Headcount" htmlFor="headcount">
            <input id="headcount" name="headcount" type="number" min={0} className={inputClass} />
          </Field>
          <Field label="Setup requirements" htmlFor="setupNotes" hint="Shown on the custodial setup board.">
            <textarea id="setupNotes" name="setupNotes" rows={2} className={inputClass} />
          </Field>
          <Field label="Equipment" htmlFor="equipmentNotes">
            <textarea id="equipmentNotes" name="equipmentNotes" rows={2} className={inputClass} />
          </Field>
        </div>
      )}

      {isAdmin && (
        <label className="flex items-center gap-2 text-sm text-navy-700">
          <input type="checkbox" name="overrideAvailability" className="rounded border-navy-400" />
          Override published hours and blackouts (administrators only; the override is logged)
        </label>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Checking availability…" : "Request booking"}
      </Button>
    </form>
  );
}
