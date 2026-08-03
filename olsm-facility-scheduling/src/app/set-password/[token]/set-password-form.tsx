"use client";

import { useActionState } from "react";
import { setPasswordAction, type FormState } from "@/app/actions/auth-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const initial: FormState = {};

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(setPasswordAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      {/*
        Shown, disabled, and outside the submission. Password managers need a
        username field to file the entry against, and the reader needs to see
        which account they are setting a password for -- but the address comes
        from the token, never from what is posted back.
      */}
      <Field label="Account">
        <input
          type="email"
          value={email}
          disabled
          readOnly
          autoComplete="username"
          className={`${inputClass} bg-navy-50 text-navy-600`}
        />
      </Field>

      <Field
        label="Choose a password"
        htmlFor="password"
        hint="At least 12 characters, with upper case, lower case and a number."
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={inputClass}
        />
      </Field>

      <Field label="Type it again" htmlFor="confirm">
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={inputClass}
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Setting your password…" : "Set password and sign in"}
      </Button>
    </form>
  );
}
