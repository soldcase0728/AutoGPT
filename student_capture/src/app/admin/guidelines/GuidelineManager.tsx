"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";

interface Item { id: string; text: string; required: boolean; safety: boolean }
export interface ChecklistSet { id: string; name: string; kind: string; version: number; summary: string; items: Item[] }

const input = "rounded border bg-transparent px-3 py-2";
const blank: Item = { id: "", text: "", required: true, safety: false };

function Editor({ initial, onSaved, onCancel }: { initial?: ChecklistSet; onSaved: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "craft");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [items, setItems] = useState<Item[]>(initial?.items.length ? initial.items : [{ ...blank }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(index: number, patch: Partial<Item>) {
    setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch(initial ? `/api/admin/guidelines/${initial.id}` : "/api/admin/guidelines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, kind, summary, items: items.filter((i) => i.text.trim()) }),
    });
    setBusy(false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error || "That didn't save.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="flex flex-col gap-1"><span className="label">Name</span>
          <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={input} style={{ borderColor: "var(--rule)" }} placeholder="Vertical video craft" />
        </label>
        <label className="flex flex-col gap-1"><span className="label">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={input} style={{ borderColor: "var(--rule)" }}>
            <option value="craft">Craft (how to shoot)</option>
            <option value="brand">Brand (what&apos;s allowed)</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1"><span className="label">One-line summary (optional)</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} className={input} style={{ borderColor: "var(--rule)" }} />
      </label>
      <p className="label mt-2">Lines students see</p>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-sm border p-3" style={{ borderColor: item.safety ? "var(--clay)" : "var(--rule)" }}>
            <input value={item.text} onChange={(e) => update(index, { text: e.target.value })} aria-label={`Line ${index + 1}`} placeholder="Hold the phone upright." className={input} style={{ borderColor: "var(--rule)" }} />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={item.safety} onChange={(e) => update(index, { safety: e.target.checked })} /> Safety rule (the student confirms it before shooting)</label>
              <label className="flex items-center gap-2" style={{ opacity: item.safety ? 0.5 : 1 }}><input type="checkbox" disabled={item.safety} checked={item.safety || item.required} onChange={(e) => update(index, { required: e.target.checked })} /> Required</label>
              <button type="button" className="ml-auto underline" style={{ color: "var(--muted)" }} onClick={() => setItems((list) => list.filter((_, i) => i !== index))}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-quiet self-start" onClick={() => setItems((list) => [...list, { ...blank }])}>Add a line</button>
      {initial && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Saving makes version {initial.version + 1}. Version {initial.version} is kept, so past submissions still show the wording they were shot under.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={busy}>{initial ? "Save new version" : "Create checklist"}</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
        {error && <span className="text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</span>}
      </div>
    </form>
  );
}

export function GuidelineManager({ checklists }: { checklists: ChecklistSet[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/tasks" className="text-sm underline">← Tasks</Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Checklists</h1>
            <p className="mt-2 max-w-xl text-sm" style={{ color: "var(--muted)" }}>
              What students read on the capture screen. Safety lines are confirmed with one tick before the camera opens; the rest are for reading.
            </p>
          </div>
          <button className="btn" onClick={() => setCreating((c) => !c)}>{creating ? "Close" : "New checklist"}</button>
        </div>
      </div>
      {creating && (
        <section className="card p-5"><Editor onSaved={() => { setCreating(false); router.refresh(); }} onCancel={() => setCreating(false)} /></section>
      )}
      <ul className="flex flex-col gap-3">
        {checklists.map((set) => (
          <li key={set.id} className="card p-5">
            {editing === set.id ? (
              <Editor initial={set} onSaved={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{set.name}</p>
                    <Chip>{set.kind}</Chip>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>v{set.version}</span>
                  </div>
                  <button className="btn btn-quiet" onClick={() => setEditing(set.id)}>Edit</button>
                </div>
                {set.summary && <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{set.summary}</p>}
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  {set.items.map((item) => (
                    <li key={item.id} style={{ color: item.safety ? "var(--clay)" : undefined }}>
                      {item.safety ? "Safety: " : "— "}{item.text}{!item.required && !item.safety ? " (optional)" : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </li>
        ))}
        {checklists.length === 0 && <li className="card p-5 text-sm" style={{ color: "var(--muted)" }}>No checklists yet.</li>}
      </ul>
    </div>
  );
}
