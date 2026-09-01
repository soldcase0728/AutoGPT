"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RELEASE_VERSION } from "./version";

export function ConsentForm({
  personId,
  displayName,
}: {
  personId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const matches = typed.trim().toLowerCase() === displayName.trim().toLowerCase();

  async function sign(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const supabase = createClient();
    const { error: insertError } = await supabase.from("consents").insert({
      person_id: personId,
      type: "media_release",
      document_version: RELEASE_VERSION,
      signed_by: displayName,
    });

    if (insertError) {
      setSaving(false);
      setError(insertError.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={sign} className="mt-6 flex flex-col gap-3">
      <label className="label" htmlFor="signature">
        Type your name to sign
      </label>
      <input
        id="signature"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="card px-3 py-3"
        style={{ background: "var(--surface)" }}
        placeholder={displayName}
        autoComplete="off"
      />
      <button className="btn" disabled={!matches || saving}>
        {saving ? "Saving…" : "I agree"}
      </button>
      {error && (
        <p className="text-sm" style={{ color: "var(--clay)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
