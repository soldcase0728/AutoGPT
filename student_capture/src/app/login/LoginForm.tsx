"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "signing-in" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("signing-in");
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus("error");
      setMessage("The email or password is incorrect.");
      return;
    }

    const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    router.replace(destination);
    router.refresh();
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
      <label className="label mt-2" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="card px-3 py-3"
        style={{ background: "var(--surface)" }}
      />
      <button className="btn mt-1" disabled={status === "signing-in"}>
        {status === "signing-in" ? "Signing in…" : "Sign in"}
      </button>
      {status === "error" && (
        <p className="text-sm" style={{ color: "var(--clay)" }}>
          {message}
        </p>
      )}
    </form>
  );
}
