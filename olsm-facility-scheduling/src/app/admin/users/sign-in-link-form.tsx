"use client";

import { useActionState } from "react";
import { sendSignInLinkAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button } from "@/components/ui";

const initial: AdminFormState = {};

export function SignInLinkForm({ userId, activated }: { userId: string; activated: boolean }) {
  const [state, action, pending] = useActionState(sendSignInLinkAction, initial);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {/*
        The notice can carry a link when no email provider is configured, so it
        needs room to wrap rather than being squeezed onto the button row.
      */}
      {state.notice && (
        <Alert tone="success">
          <span className="break-all">{state.notice}</span>
        </Alert>
      )}

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : activated ? "Send a password-reset link" : "Resend sign-in link"}
      </Button>
    </form>
  );
}
