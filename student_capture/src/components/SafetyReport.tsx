"use client";

import { useState } from "react";

const KINDS = [
  { id: "unsafe_filming", label: "Unsafe to film" },
  { id: "protected_material", label: "Private student info in frame" },
  { id: "prohibited_content", label: "Alcohol, vaping or gambling in frame" },
  { id: "other", label: "Something else" },
];

/**
 * Rule 6: anyone must be able to say a shot is unsafe — above all the student
 * who was asked to take it. Deliberately two taps from the capture screen.
 */
export function SafetyReport({
  captureId,
  ideaId,
}: {
  captureId?: string;
  ideaId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(KINDS[0]!.id);
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");

    const response = await fetch("/api/safety", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, detail, captureId, ideaId }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Could not send that." }));
      setState("error");
      setMessage(body.error ?? "Could not send that.");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <p className="mt-4 text-[15px]" style={{ color: "var(--moss)" }}>
        Reported. Someone will look at this — you do not have to shoot it.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-sm underline underline-offset-4"
        style={{ color: "var(--clay)" }}
      >
        Report something unsafe about this prompt
      </button>
    );
  }

  return (
    <form onSubmit={send} className="mt-4 flex flex-col gap-3">
      <label className="label" htmlFor="safety-kind">
        What is wrong?
      </label>
      <select
        id="safety-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="card px-3 py-2"
        style={{ background: "var(--bg)" }}
      >
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={3}
        required
        placeholder="What happened, or what would you have had to do?"
        className="card px-3 py-2"
        style={{ background: "var(--bg)" }}
      />
      <div className="flex gap-2">
        <button className="btn" disabled={state === "sending" || !detail.trim()}>
          {state === "sending" ? "Sending…" : "Send report"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {state === "error" && (
        <p className="text-sm" style={{ color: "var(--clay)" }}>
          {message}
        </p>
      )}
    </form>
  );
}
