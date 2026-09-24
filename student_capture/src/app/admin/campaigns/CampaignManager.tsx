"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";

interface Campaign { id: string; name: string; startsOn: string; endsOn: string | null; active: boolean; taskCount: number }

const input = "rounded border bg-transparent px-3 py-2";

function CampaignForm({ initial, today, onSaved, onCancel }: {
  initial?: Campaign; today: string; onSaved: () => void; onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? today);
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch(initial ? `/api/admin/campaigns/${initial.id}` : "/api/admin/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, startsOn, endsOn: endsOn || null, active }),
    });
    setBusy(false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "That didn't save.");
      return;
    }
    if (!initial) { setName(""); setEndsOn(""); }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="label">Name</span>
        <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={input} style={{ borderColor: "var(--rule)" }} placeholder="Fall open house" />
      </label>
      <label className="flex flex-col gap-1"><span className="label">Starts</span>
        <input type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={input} style={{ borderColor: "var(--rule)" }} />
      </label>
      <label className="flex flex-col gap-1"><span className="label">Ends (optional)</span>
        <input type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={input} style={{ borderColor: "var(--rule)" }} />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (new tasks can use it)
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button className="btn" disabled={busy}>{initial ? "Save" : "Create campaign"}</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
        {error && <span className="text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</span>}
      </div>
    </form>
  );
}

export function CampaignManager({ campaigns, today }: { campaigns: Campaign[]; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/tasks" className="text-sm underline">← Tasks</Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          A campaign groups tasks around one push, like an open house or a season. Tasks can only use active campaigns.
        </p>
      </div>
      <section className="card p-5">
        <p className="label mb-3">New campaign</p>
        <CampaignForm today={today} onSaved={() => router.refresh()} />
      </section>
      <ul className="flex flex-col gap-2">
        {campaigns.map((c) => (
          <li key={c.id} className="card p-4">
            {editing === c.id ? (
              <CampaignForm initial={c} today={today} onSaved={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {c.startsOn}{c.endsOn ? ` to ${c.endsOn}` : " onward"} · {c.taskCount} task{c.taskCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Chip tone={c.active ? "good" : "muted"}>{c.active ? "Active" : "Archived"}</Chip>
                  <button className="btn btn-quiet" onClick={() => setEditing(c.id)}>Edit</button>
                </div>
              </div>
            )}
          </li>
        ))}
        {campaigns.length === 0 && <li className="card p-5 text-sm" style={{ color: "var(--muted)" }}>No campaigns yet.</li>}
      </ul>
    </div>
  );
}
