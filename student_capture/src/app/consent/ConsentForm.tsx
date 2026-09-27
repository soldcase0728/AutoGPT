"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signatureMatches } from "@/lib/consent";
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

  async function sign(event: React.FormEvent) {
    event.preventDefault();
    // Say what's wrong instead of leaving a grey button nobody can explain.
    if (!signatureMatches(typed, displayName)) {
      setError(`Type your name as the school has it: ${displayName}. If that's wrong, ask the marketing desk to fix it.`);
      return;
    }
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
      setError("That didn't save. Check your connection and tap I agree again.");
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
      <p className="-mt-1 text-sm" style={{ color: "var(--muted)" }}>
        As the school has it: <span className="font-semibold" style={{ color: "var(--ink)" }}>{displayName}</span>
      </p>
      <input
        id="signature"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          if (error) setError("");
        }}
        className="card px-3 py-3"
        style={{ background: "var(--surface)" }}
        placeholder="Your full name"
        autoComplete="name"
        autoCapitalize="words"
      />
      <button className="btn" disabled={!typed.trim() || saving}>
        {saving ? "Saving…" : "I agree"}
      </button>
      {error && (
        <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
