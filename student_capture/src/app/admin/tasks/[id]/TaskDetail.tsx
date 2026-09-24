"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";
import { STATUS_LABEL, type AssignmentStatus, type TaskProgress } from "@/lib/task-progress";

export interface TaskStudentRow {
  assignmentId: string;
  personId: string;
  name: string;
  email: string;
  dueOn: string;
  status: AssignmentStatus;
}

interface Task {
  id: string;
  title: string;
  brief: string;
  campaign: string;
  mediaType: string;
  orientation: string;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  captionRequired: boolean;
  guidelineSetIds: string[];
  active: boolean;
  cancelled: boolean;
}

const TONE: Record<AssignmentStatus, "muted" | "good" | "bad" | "accent"> = {
  upcoming: "muted",
  not_sent: "bad",
  sent: "accent",
  reshoot: "accent",
  approved: "good",
  posted: "good",
  rejected: "bad",
  withdrawn: "muted",
};

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono tabular-nums" style={{ color: "var(--muted)" }}>
          {value} of {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--sunk)" }}>
        <div className="h-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function TaskDetail({
  task,
  progress,
  rows,
  guidelineSets,
}: {
  task: Task;
  progress: TaskProgress;
  rows: TaskStudentRow[];
  guidelineSets: Array<{ id: string; name: string; kind: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [brief, setBrief] = useState(task.brief);
  const [captionRequired, setCaptionRequired] = useState(task.captionRequired);
  const [guidelines, setGuidelines] = useState(task.guidelineSetIds);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const missing = useMemo(() => {
    const seen = new Map<string, TaskStudentRow>();
    for (const row of rows) {
      if (row.status === "not_sent" && !seen.has(row.personId)) seen.set(row.personId, row);
    }
    return [...seen.values()];
  }, [rows]);

  async function act(body: object, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch(`/api/admin/tasks/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error || "That didn't save.");
      return;
    }
    setNotice(
      success +
        (typeof payload.removed_assignments === "number"
          ? ` ${payload.removed_assignments} upcoming assignment${payload.removed_assignments === 1 ? " was" : "s were"} removed.`
          : ""),
    );
    setEditing(false);
    setConfirmCancel(false);
    router.refresh();
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    void act({ action: "edit", title, brief, captionRequired, guidelineSetIds: guidelines }, "Saved. Students see the new wording next time they open it.");
  }

  const emails = missing.map((m) => m.email).filter(Boolean);
  const nudgeBody = `Hi,\n\nQuick reminder: "${task.title}" is waiting for you in the Capture app. It takes about a minute.\n\nThanks!`;
  const mailto = `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(`Reminder: ${task.title}`)}&body=${encodeURIComponent(nudgeBody)}`;
  const status = task.cancelled ? "Cancelled" : task.active ? "Active" : "Paused";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/tasks" className="text-sm underline">← All tasks</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="label">{task.campaign} · {task.mediaType.replace("_", " ")} · {task.orientation}
              {task.mediaType === "video" && task.minDurationSeconds != null ? ` · ${task.minDurationSeconds}–${task.maxDurationSeconds}s` : ""}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{task.title}</h1>
            <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>{task.brief}</p>
          </div>
          <Chip tone={task.cancelled ? "bad" : task.active ? "good" : "accent"}>{status}</Chip>
        </div>
      </div>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <Bar label="Sent" value={progress.sent} total={progress.due} color="var(--accent)" />
        <Bar label="Approved" value={progress.approved} total={progress.due} color="var(--moss)" />
        <Bar label="Posted" value={progress.posted} total={progress.due} color="var(--moss)" />
        <div className="flex flex-col justify-center text-sm" style={{ color: "var(--muted)" }}>
          <p>{progress.assigned} assignment{progress.assigned === 1 ? "" : "s"} in total, {progress.due} due so far.</p>
          <p className="mt-1">
            <Link className="underline" href={`/review?tab=review&task=${task.id}`}>Open this task in the queue</Link>
          </p>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="label">Haven&rsquo;t sent anything yet · {missing.length}</p>
          {missing.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <a className="btn" href={mailto}>Nudge by email</a>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  navigator.clipboard?.writeText(emails.join(", ")).then(() => setCopied(true), () => undefined);
                }}
              >
                {copied ? "Copied" : "Copy their emails"}
              </button>
            </div>
          )}
        </div>
        {missing.length > 0 ? (
          <>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              The app doesn&rsquo;t send reminders itself yet. &ldquo;Nudge by email&rdquo; opens your mail app with them in BCC and a short reminder.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {missing.map((m) => <li key={m.personId}><Chip>{m.name}</Chip></li>)}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Everyone due has sent something.</p>
        )}
      </section>

      <section className="card p-5">
        <p className="label">Every assignment</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left" style={{ color: "var(--muted)" }}>
                <th className="py-2 pr-4 font-normal">Student</th>
                <th className="py-2 pr-4 font-normal">Due</th>
                <th className="py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.assignmentId} className="border-t" style={{ borderColor: "var(--rule)" }}>
                  <td className="py-2 pr-4">{row.name}</td>
                  <td className="py-2 pr-4 font-mono tabular-nums">{row.dueOn}</td>
                  <td className="py-2"><Chip tone={TONE[row.status]}>{STATUS_LABEL[row.status]}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>No assignments.</p>}
        </div>
      </section>

      {!task.cancelled && (
        <section className="card flex flex-col gap-4 p-5">
          <p className="label">Change this task</p>
          {editing ? (
            <form onSubmit={saveEdit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1"><span className="label">Title</span>
                <input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
              </label>
              <label className="flex flex-col gap-1"><span className="label">What students should capture</span>
                <textarea required minLength={10} maxLength={2000} rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
              </label>
              <fieldset className="flex flex-wrap gap-3"><legend className="label mb-1">Checklists</legend>
                {guidelineSets.map((set) => (
                  <label key={set.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={guidelines.includes(set.id)} onChange={(e) => setGuidelines((g) => e.target.checked ? [...g, set.id] : g.filter((x) => x !== set.id))} />
                    {set.name}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={captionRequired} onChange={(e) => setCaptionRequired(e.target.checked)} />
                Require a short caption from the student
              </label>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Media type and dates can&rsquo;t change once students have it. To change those, cancel this task and create a new one from it.
              </p>
              <div className="flex gap-2">
                <button className="btn" disabled={busy}>Save changes</button>
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-quiet" onClick={() => setEditing(true)}>Edit wording</button>
              {task.active ? (
                <button className="btn btn-quiet" disabled={busy} onClick={() => void act({ action: "pause" }, "Paused. Students won't see it until you resume.")}>Pause</button>
              ) : (
                <button className="btn btn-quiet" disabled={busy} onClick={() => void act({ action: "resume" }, "Resumed.")}>Resume</button>
              )}
              {confirmCancel ? (
                <span className="flex flex-wrap items-center gap-2 rounded-sm border p-2" style={{ borderColor: "var(--clay)" }}>
                  <span className="text-sm">Remove every upcoming assignment nobody has started? What was sent stays.</span>
                  <button className="btn" style={{ background: "var(--clay)", borderColor: "var(--clay)" }} disabled={busy} onClick={() => void act({ action: "cancel" }, "Cancelled.")}>Cancel task</button>
                  <button className="btn btn-quiet" onClick={() => setConfirmCancel(false)}>Keep it</button>
                </span>
              ) : (
                <button className="btn btn-quiet" style={{ color: "var(--clay)" }} onClick={() => setConfirmCancel(true)}>Cancel task…</button>
              )}
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</p>}
          {notice && <p className="text-sm" style={{ color: "var(--moss)" }} role="status">{notice}</p>}
        </section>
      )}
    </div>
  );
}
