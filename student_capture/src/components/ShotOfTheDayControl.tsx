"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { awardDateLabel, localDate, type ShotAward } from "@/lib/shot-of-the-day";

/**
 * In the review panel, for an approved or posted shot: award it Shot of the
 * Day, or see and take back an award it already has. Admins only.
 */
export function ShotOfTheDayControl({
  captureId,
  award,
  todaysPick,
}: {
  captureId: string;
  award: ShotAward | null;
  /** Today's winner, if it's a different shot: picking this one replaces it. */
  todaysPick: { student: string; title: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(method: "POST" | "DELETE", body: object) {
    setBusy(true);
    setError("");
    const response = await fetch("/api/review/shot-of-the-day", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const payload = await response?.json().catch(() => ({}));
      setError(payload?.error || "That didn't save. Try again.");
      return;
    }
    setOpen(false);
    setNote("");
    router.refresh();
  }

  if (award) {
    return (
      <div className="rounded-sm border p-3" style={{ borderColor: "var(--brand)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-ink)" }}>
          ★ Shot of the Day · {awardDateLabel(award.awardedOn)}
        </p>
        {award.note && <p className="mt-1 text-sm">&ldquo;{award.note}&rdquo;</p>}
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>The student sees this on their page.</p>
        <button
          type="button"
          className="mt-2 text-sm underline underline-offset-4"
          style={{ color: "var(--muted)" }}
          disabled={busy}
          onClick={() => void send("DELETE", { awardId: award.id })}
        >
          Take the award back
        </button>
        {error && <p className="mt-1 text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</p>}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-quiet self-start"
        style={{ borderColor: "var(--brand)", color: "var(--brand-ink)" }}
        onClick={() => setOpen(true)}
      >
        ★ Make it Shot of the Day
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border p-3" style={{ borderColor: "var(--brand)" }}>
      <label className="label" htmlFor={`sotd-${captureId}`}>What made it great? (optional)</label>
      <textarea
        id={`sotd-${captureId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={280}
        className="card w-full px-3 py-2"
        style={{ background: "var(--bg)" }}
        placeholder="The student sees this with their award."
      />
      {todaysPick && (
        <p className="text-sm" style={{ color: "var(--accent)" }}>
          This replaces today&rsquo;s pick: {todaysPick.student}, &ldquo;{todaysPick.title}&rdquo;.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          style={{ background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }}
          disabled={busy}
          onClick={() => void send("POST", { captureId, date: localDate(), note: note.trim() || undefined })}
        >
          Award it
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Not now</button>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</p>}
    </div>
  );
}
