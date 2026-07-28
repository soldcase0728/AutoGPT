"use client";

import { useActionState } from "react";
import { signDocumentAction, type DocumentFormState } from "@/app/actions/document-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";

const initial: DocumentFormState = {};

export function SignForm({ documentId, defaultName }: { documentId: string; defaultName: string }) {
  const [state, action, pending] = useActionState(signDocumentAction, initial);

  if (state.notice) {
    return (
      <Alert tone="success" title="Signed">
        {state.notice} Any booking waiting on this document has moved forward automatically.
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="documentId" value={documentId} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <Field
        label="Type your full legal name to sign"
        htmlFor="typedName"
        hint="Your typed name, the time and your IP address are recorded as the signature."
      >
        <input id="typedName" name="typedName" required defaultValue={defaultName} className={inputClass} />
      </Field>

      <label className="flex items-start gap-2 text-sm text-navy-800">
        <input type="checkbox" name="agree" required className="mt-0.5 rounded border-navy-400" />
        <span>I have read the terms above and agree to them.</span>
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Signing…" : "Sign document"}
      </Button>
    </form>
  );
}
