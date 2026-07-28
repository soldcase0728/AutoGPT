"use client";

import { useActionState } from "react";
import { uploadCoiAction, type DocumentFormState } from "@/app/actions/document-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { INSURANCE_REQUIREMENT_TEXT } from "./insurance-text";

const initial: DocumentFormState = {};

export function CoiUploadForm({ documentId, bookingId }: { documentId: string; bookingId: string }) {
  const [state, action, pending] = useActionState(uploadCoiAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="bookingId" value={bookingId} />

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.notice && <Alert tone="success">{state.notice}</Alert>}

      <p className="text-sm text-navy-700">{INSURANCE_REQUIREMENT_TEXT}</p>

      <Field label="Certificate file" htmlFor="file" hint="PDF, PNG or JPEG, up to 10 MB.">
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          required
          className={inputClass}
        />
      </Field>

      <Field
        label="Expiry date"
        htmlFor="expiresAt"
        hint="The certificate must still be valid on the day of the booking."
      >
        <input id="expiresAt" name="expiresAt" type="date" required className={inputClass} />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload certificate"}
      </Button>
    </form>
  );
}
