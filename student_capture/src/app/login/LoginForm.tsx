"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <p className="mt-8 text-[15px] leading-relaxed">
        Check <strong>{email}</strong>. The link signs you straight in — open it on your
        phone if that is where you shoot.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
      <label className="label" htmlFor="email">
        School email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="card px-3 py-3"
        style={{ background: "var(--surface)" }}
        placeholder="you@example.edu"
      />
      <button className="btn mt-1" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Email me a link"}
      </button>
      {status === "error" && (
        <p className="text-sm" style={{ color: "var(--clay)" }}>
          {message}
        </p>
      )}
    </form>
  );
}
