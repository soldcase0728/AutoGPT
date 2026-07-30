"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
  defaultStartTime,
  defaultEndTime,
  defaultSportId,
  defaultTeamLevel,
  defaultActivityType,
  defaultTitle,
  isAdmin,
}: {
  spaces: SpaceOption[];
  activities: BookOption[];
  sports: { id: string; name: string }[];
  supervisors: { id: string; name: string; role: string }[];
  defaultDate: string;
  defaultSubSpaceId?: string;
  /** Prefilled when the user dragged a range on the calendar. */
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultSportId?: string;
  defaultTeamLevel?: TeamLevel;
  /** Prefilled when repeating an earlier booking. */
  defaultActivityType?: ActivityType;
  defaultTitle?: string;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(createBookingAction, initial);
  const [activityType, setActivityType] = useState<ActivityType>(
    // A repeat carries the earlier booking's activity; otherwise the common
    // case is an in-season practice.
    (defaultActivityType && activities.some((a) => a.value === defaultActivityType)
      ? defaultActivityType
      : activities.find((a) => a.value === ActivityType.TEAM_PRACTICE)?.value) ??
      activities[0]?.value,
  );
  const [subSpaceId, setSubSpaceId] = useState(defaultSubSpaceId ?? spaces[0]?.id ?? "");
  const [showDetails, setShowDetails] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [headcount, setHeadcount] = useState("");
  const [setupNotes, setSetupNotes] = useState("");
  const [equipmentNotes, setEquipmentNotes] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(defaultStartTime ?? "15:30");
  const [endTime, setEndTime] = useState(defaultEndTime ?? "17:30");

  const formRef = useRef<HTMLFormElement>(null);

  // React resets the form once a form action completes. For the selects that
  // reverts the DOM to the first option until something else triggers a render,
  // so straight after a rejected booking the form would show a different space
  // from the one it holds and would submit. The values are correct underneath;
  // this re-asserts them so what is on screen matches what would be sent.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const space = form.elements.namedItem("subSpaceId");
    if (space instanceof HTMLSelectElement) space.value = subSpaceId;
    const activity = form.elements.namedItem("activityType");
    if (activity instanceof HTMLSelectElement) activity.value = activityType;
  }, [state, subSpaceId, activityType]);

  const selectedSpace = spaces.find((s) => s.id === subSpaceId);
  const selectedActivity = activities.find((a) => a.value === activityType);
  const isTeamActivity =
    activityType === ActivityType.TEAM_PRACTICE ||
    activityType === ActivityType.CONTEST ||
    activityType === ActivityType.TEAM_OFFSEASON;

  return (
    <form ref={formRef} action={action} className="space-y-4">
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

          {/*
            A clash should be a choice, not a dead end. Each of these is a slot
            the server checked and would accept; picking one fills the form in
            so the next click is the booking itself.
          */}
          {state.alternatives && state.alternatives.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">These are free instead:</p>
              <ul className="mt-2 space-y-2">
                {state.alternatives.map((alt) => (
                  <li key={`${alt.subSpaceId}-${alt.date}-${alt.startTime}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setSubSpaceId(alt.subSpaceId);
                        setDate(alt.date);
                        setStartTime(alt.startTime);
                        setEndTime(alt.endTime);
                      }}
                      className="w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-left hover:border-navy-500 hover:bg-navy-50"
                    >
                      <span className="block font-medium text-navy-900">{alt.when}</span>
                      <span className="block text-xs text-navy-600">
                        {alt.label} · {alt.reason}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-navy-600">
                Choosing one fills the form in. Nothing is booked until you submit.
              </p>
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
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Boys Basketball practice"
          className={inputClass}
        />
      </Field>

      {/*
        Controlled, so choosing a suggested alternative can fill them in. They
        were uncontrolled defaults before; a suggestion that cannot move the
        date is not much of a suggestion.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="date">
          <input
            id="date"
            name="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Start" htmlFor="startTime">
          <input
            id="startTime"
            name="startTime"
            type="time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="End" htmlFor="endTime">
          <input
            id="endTime"
            name="endTime"
            type="time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className={inputClass}
          />
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
            <input
              id="headcount"
              name="headcount"
              type="number"
              min={0}
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Setup requirements" htmlFor="setupNotes" hint="Shown on the custodial setup board.">
            <textarea
              id="setupNotes"
              name="setupNotes"
              rows={2}
              value={setupNotes}
              onChange={(e) => setSetupNotes(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Equipment" htmlFor="equipmentNotes">
            <textarea
              id="equipmentNotes"
              name="equipmentNotes"
              rows={2}
              value={equipmentNotes}
              onChange={(e) => setEquipmentNotes(e.target.value)}
              className={inputClass}
            />
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
