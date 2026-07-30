"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { ActivityType } from "@prisma/client";
import { submitExternalRequestAction, type RequestFormState } from "@/app/actions/request-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

interface Space {
  id: string;
  label: string;
  facilitySlug: string;
  capacity: number;
}

interface Activity {
  value: ActivityType;
  label: string;
  description: string;
}

const initial: RequestFormState = {};

const STEPS = ["When", "Where", "What", "Who"] as const;

/**
 * Four steps in one form. Keeping it a single form means a half-finished
 * request survives a validation error, and the whole thing works without
 * JavaScript if the steps are all revealed.
 */
export function RequestWizard({
  spaces,
  activities,
  defaultDate,
  defaultSubSpaceId,
  signedIn,
}: {
  spaces: Space[];
  activities: Activity[];
  defaultDate: string;
  defaultSubSpaceId?: string;
  signedIn: boolean;
}) {
  const [state, action, pending] = useActionState(submitExternalRequestAction, initial);
  const [step, setStep] = useState(0);
  const [activityType, setActivityType] = useState<ActivityType>(activities[0]?.value);

  const selectedActivity = activities.find((a) => a.value === activityType);

  if (state.submitted) {
    return (
      <Alert tone="success" title="Request submitted">
        <p>{state.notice}</p>
        <p className="mt-2">
          {signedIn ? (
            <Link href="/portal" className="font-medium underline">
              Track it in your portal
            </Link>
          ) : (
            <>
              We have emailed you a link to track it. You can also{" "}
              <Link href="/sign-in" className="font-medium underline">
                sign in
              </Link>{" "}
              with the account we just created.
            </>
          )}
        </p>
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={step === i ? "step" : undefined}
              className={
                step === i
                  ? "rounded-full bg-navy-800 px-3 py-1 font-medium text-white"
                  : "rounded-full bg-navy-100 px-3 py-1 text-navy-700"
              }
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      {/* Every step stays mounted so nothing is lost when moving back. */}
      <div className={step === 0 ? "space-y-3" : "hidden"}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date" htmlFor="date">
            <input id="date" name="date" type="date" required defaultValue={defaultDate} className={inputClass} />
          </Field>
          <Field label="Start" htmlFor="startTime">
            <input id="startTime" name="startTime" type="time" required defaultValue="18:00" className={inputClass} />
          </Field>
          <Field label="End" htmlFor="endTime">
            <input id="endTime" name="endTime" type="time" required defaultValue="20:00" className={inputClass} />
          </Field>
        </div>
      </div>

      <div className={step === 1 ? "space-y-3" : "hidden"}>
        <Field label="Facility and space" htmlFor="subSpaceId">
          <select
            id="subSpaceId"
            name="subSpaceId"
            required
            defaultValue={defaultSubSpaceId ?? spaces[0]?.id}
            className={inputClass}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} (capacity {s.capacity})
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className={step === 2 ? "space-y-3" : "hidden"}>
        <Field label="Type of use" htmlFor="activityType" hint={selectedActivity?.description}>
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

        <Field label="What is it?" htmlFor="title">
          <input
            id="title"
            name="title"
            required
            minLength={3}
            placeholder="U14 travel team practice"
            className={inputClass}
          />
        </Field>

        <Field label="Expected headcount" htmlFor="headcount">
          <input id="headcount" name="headcount" type="number" min={1} required className={inputClass} />
        </Field>

        <Field label="Setup requirements" htmlFor="setupNotes" hint="Optional. Shared with facilities staff.">
          <textarea id="setupNotes" name="setupNotes" rows={2} className={inputClass} />
        </Field>
      </div>

      <div className={step === 3 ? "space-y-3" : "hidden"}>
        {!signedIn && (
          <>
            <Field label="Your name" htmlFor="name">
              <input id="name" name="name" required autoComplete="name" className={inputClass} />
            </Field>
            <Field label="Email address" htmlFor="email">
              <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
            </Field>
            <Field label="Mobile number" htmlFor="phone" hint="Used for weather cancellations and day-before reminders.">
              <input id="phone" name="phone" type="tel" autoComplete="tel" className={inputClass} />
            </Field>
            <Field label="Organization" htmlFor="organization" hint="Leave blank if you are booking as an individual.">
              <input id="organization" name="organization" className={inputClass} />
            </Field>
          </>
        )}

        <Alert tone="info" title="What happens after you submit">
          Your slot is held while the athletic office reviews the request. You will then be asked for
          a signed agreement, a liability waiver, a certificate of insurance and payment. The booking
          is not confirmed until all four are complete.
        </Alert>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 && (
          <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)}>
            Next
          </Button>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? "Submitting…" : "Submit request"}
          </Button>
        )}
      </div>
    </form>
  );
}
