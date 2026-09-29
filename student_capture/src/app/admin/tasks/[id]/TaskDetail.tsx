"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";
import { STATUS_LABEL, schoolDays, type AssignmentStatus, type TaskProgress } from "@/lib/task-progress";
import { expandTaskDates } from "@/lib/admin-task";

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
  /** Anything sent for it at all; such a task can be cancelled but not deleted. */
  hasSubmissions: boolean;
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
  today,
  students = [],
  groups = [],
}: {
  task: Task;
  progress: TaskProgress;
  rows: TaskStudentRow[];
  guidelineSets: Array<{ id: string; name: string; kind: string }>;
  today: string;
  /** Active students who can be given this task. */
  students?: Array<{ id: string; display_name: string; email: string }>;
  groups?: Array<{ id: string; name: string; memberIds: string[] }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [brief, setBrief] = useState(task.brief);
  const [captionRequired, setCaptionRequired] = useState(task.captionRequired);
  const [guidelines, setGuidelines] = useState(task.guidelineSetIds);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [assigning, setAssigning] = useState(rows.length === 0);
  const [pick, setPick] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [assignNotice, setAssignNotice] = useState("");
  const [assignError, setAssignError] = useState("");

  const days = useMemo(() => {
    const all = expandTaskDates(startsOn, endsOn);
    return all ? schoolDays(all, weekdaysOnly) : null;
  }, [endsOn, startsOn, weekdaysOnly]);
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? students.filter((s) => `${s.display_name} ${s.email}`.toLowerCase().includes(needle))
    : students;
  const activeIds = new Set(students.map((s) => s.id));

  async function assign(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setAssignError("");
    setAssignNotice("");
    const response = await fetch(`/api/admin/tasks/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "assign", studentIds: pick, startsOn, endsOn, weekdaysOnly }),
    });
    setBusy(false);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAssignError(payload.error || "That didn't save.");
      return;
    }
    const skipped = (payload.skipped ?? []) as Array<{ name: string; dueOn: string }>;
    setAssignNotice(
      `Assigned: ${payload.createdAssignments} assignment${payload.createdAssignments === 1 ? "" : "s"}.` +
        (skipped.length
          ? ` Skipped because they already have a task that day: ${skipped.slice(0, 8).map((x) => `${x.name} (${x.dueOn})`).join(", ")}${skipped.length > 8 ? `, and ${skipped.length - 8} more` : ""}.`
          : ""),
    );
    setPick([]);
    router.refresh();
  }

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
    if (payload.deleted) {
      router.push("/admin/tasks");
      router.refresh();
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
        <section className="card flex flex-col gap-4 p-5" aria-label="Assign students">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="label">{rows.length === 0 ? "Nobody assigned yet" : "Assign more students"}</p>
            {!assigning && (
              <button type="button" className="btn btn-quiet" onClick={() => setAssigning(true)}>Assign students…</button>
            )}
          </div>
          {assigning && (
            <form onSubmit={assign} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1"><span className="label">First day</span>
                  <input type="date" required value={startsOn} onChange={(e) => { setStartsOn(e.target.value); if (endsOn < e.target.value) setEndsOn(e.target.value); }} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
                </label>
                <label className="flex flex-col gap-1"><span className="label">Last day</span>
                  <input type="date" required min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} />
                  School days only
                </label>
              </div>
              {groups.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <button key={g.id} type="button" className="rounded-sm border px-2 py-1 text-sm" style={{ borderColor: "var(--rule)" }}
                      onClick={() => setPick((p) => [...new Set([...p, ...g.memberIds.filter((id) => activeIds.has(id))])])}>
                      + {g.name}
                    </button>
                  ))}
                </div>
              )}
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a student" className="rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--rule)" }} />
              <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                {shown.map((s) => (
                  <label key={s.id} className="flex items-start gap-3 rounded border p-2 text-sm" style={{ borderColor: "var(--rule)" }}>
                    <input type="checkbox" className="mt-1" checked={pick.includes(s.id)}
                      onChange={(e) => setPick((p) => (e.target.checked ? [...new Set([...p, s.id])] : p.filter((x) => x !== s.id)))} />
                    <span><span className="block font-medium">{s.display_name}</span><span className="block text-xs" style={{ color: "var(--muted)" }}>{s.email}</span></span>
                  </label>
                ))}
                {students.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>No active students. Activate them in People first.</p>}
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                A student gets at most one task a day; days they already have one are skipped.
              </p>
              <div className="flex flex-wrap gap-2">
                <button className="btn" disabled={busy || pick.length === 0 || !days?.length}>
                  {pick.length === 0
                    ? "Pick students"
                    : `Assign to ${pick.length} student${pick.length === 1 ? "" : "s"}${days && days.length > 1 ? ` on ${days.length} days` : ""}`}
                </button>
                {rows.length > 0 && (
                  <button type="button" className="btn btn-quiet" onClick={() => setAssigning(false)}>Close</button>
                )}
              </div>
            </form>
          )}
          {assignError && <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">{assignError}</p>}
          {assignNotice && <p className="text-sm" style={{ color: "var(--moss)" }} role="status">{assignNotice}</p>}
        </section>
      )}

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

      {/* Deleting is only for tasks nothing was sent for: a mistake or a duplicate. */}
      {!task.hasSubmissions && (
        <section className="card flex flex-col gap-3 p-5">
          <p className="label">Delete</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Nobody has sent anything for this task, so you can delete it outright. It disappears
            from the list and from every student it was assigned to.
          </p>
          {confirmDelete ? (
            <span className="flex flex-wrap items-center gap-2 rounded-sm border p-2" style={{ borderColor: "var(--clay)" }}>
              <span className="text-sm">Delete &ldquo;{task.title}&rdquo; for good?</span>
              <button className="btn" style={{ background: "var(--clay)", borderColor: "var(--clay)" }} disabled={busy} onClick={() => void act({ action: "delete" }, "Deleted.")}>Delete task</button>
              <button className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </span>
          ) : (
            <button className="btn btn-quiet self-start" style={{ color: "var(--clay)" }} onClick={() => setConfirmDelete(true)}>Delete task…</button>
          )}
          {task.cancelled && error && <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
