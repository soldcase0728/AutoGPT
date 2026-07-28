"use client";

import { useActionState, useState } from "react";
import {
  signPublicWaiverAction,
  type PublicWaiverState,
} from "@/app/actions/participant-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const initial: PublicWaiverState = {};

export function PublicWaiverForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(signPublicWaiverAction, initial);
  const [isMinor, setIsMinor] = useState(false);

  if (state.signedName) {
    return (
      <Alert tone="success" title="Signed — thank you">
        <p>{state.signedName} is covered for this activity.</p>
        <p className="mt-2">
          If someone else in your group has not signed yet, they can use this same link.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-2"
          onClick={() => window.location.reload()}
        >
          Sign for another person
        </Button>
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <Field label="Participant's full name" htmlFor="name">
        <input id="name" name="name" required autoComplete="name" className={inputClass} />
      </Field>

      <Field
        label="Email address"
        htmlFor="email"
        hint="Optional. Used only to send a copy of what you signed."
      >
        <input id="email" name="email" type="email" autoComplete="email" className={inputClass} />
      </Field>

      <label className="flex items-start gap-2 text-sm text-navy-800">
        <input
          type="checkbox"
          name="isMinor"
          checked={isMinor}
          onChange={(e) => setIsMinor(e.target.checked)}
          className="mt-0.5 rounded border-navy-400"
        />
        <span>This participant is under 18</span>
      </label>

      {isMinor && (
        <div className="space-y-3 rounded-md border border-gold-400 bg-gold-50 p-3">
          <p className="text-sm text-gold-950">
            A parent or legal guardian must sign for a participant under 18.
          </p>
          <Field label="Parent or guardian's full name" htmlFor="guardianName">
            <input id="guardianName" name="guardianName" required={isMinor} className={inputClass} />
          </Field>
          <Field label="Parent or guardian's email" htmlFor="guardianEmail">
            <input id="guardianEmail" name="guardianEmail" type="email" className={inputClass} />
          </Field>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-navy-800">
        <input type="checkbox" name="agree" required className="mt-0.5 rounded border-navy-400" />
        <span>
          I have read the release above and agree to it
          {isMinor ? ", and I am the parent or legal guardian of the participant named" : ""}.
        </span>
      </label>

      <p className="text-xs text-navy-600">
        Your typed name, the time and your IP address are recorded as the signature.
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? "Signing…" : "Sign release"}
      </Button>
    </form>
  );
}
