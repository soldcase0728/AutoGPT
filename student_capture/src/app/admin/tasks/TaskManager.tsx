"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/Chip";
import { expandTaskDates } from "@/lib/admin-task";
import { schoolDays } from "@/lib/task-progress";
import type { PromptMediaType, PromptOrientation } from "@/lib/types";

interface Campaign { id: string; name: string; starts_on: string; ends_on: string | null }
interface Student { id: string; display_name: string; email: string; participation: string }
interface GuidelineSet { id: string; name: string; kind: string }

export interface StudentGroup {
  id: string;
  name: string;
  kind: string;
  memberIds: string[];
}

export interface TaskSummary {
  id: string;
  title: string;
  brief: string;
  campaign: string;
  mediaType: PromptMediaType;
  orientation: PromptOrientation;
  minMediaCount: number;
  maxMediaCount: number;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  captionRequired: boolean;
  guidelineSetIds: string[];
  active: boolean;
  cancelled?: boolean;
  assignmentCount: number;
  dueCount?: number;
  sentCount?: number;
  firstDueOn: string | null;
  lastDueOn: string | null;
}

const field = "w-full rounded border bg-transparent px-3 py-3";
const KIND_LABEL: Record<string, string> = { team: "Team", grade: "Grade", program: "Program", list: "List" };

export function TaskManager({ today, campaigns, students, guidelineSets, tasks, groups = [], guidelineText = {} }: {
  today: string;
  campaigns: Campaign[];
  students: Student[];
  guidelineSets: GuidelineSet[];
  tasks: TaskSummary[];
  groups?: StudentGroup[];
  guidelineText?: Record<string, string[]>;
}) {
  const router = useRouter();
  const activeStudents = useMemo(() => students.filter((student) => student.participation === "active"), [students]);
  const activeIds = useMemo(() => new Set(activeStudents.map((s) => s.id)), [activeStudents]);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [mediaType, setMediaType] = useState<PromptMediaType>("photo");
  const [orientation, setOrientation] = useState<PromptOrientation>("any");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupKind, setGroupKind] = useState("list");
  const [groupMessage, setGroupMessage] = useState("");
  const [selectedGuidelines, setSelectedGuidelines] = useState(() => guidelineSets.filter((set) => set.kind === "brand").map((set) => set.id));
  const [minCount, setMinCount] = useState(1);
  const [maxCount, setMaxCount] = useState(1);
  const [minDuration, setMinDuration] = useState(5);
  const [maxDuration, setMaxDuration] = useState(30);
  const [captionRequired, setCaptionRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [skipped, setSkipped] = useState<Array<{ name: string; dueOn: string }>>([]);
  const [error, setError] = useState("");

  const days = useMemo(() => {
    const all = expandTaskDates(startsOn, endsOn);
    return all ? schoolDays(all, weekdaysOnly) : null;
  }, [endsOn, startsOn, weekdaysOnly]);

  const needle = studentSearch.trim().toLowerCase();
  const shownStudents = needle
    ? students.filter((s) => `${s.display_name} ${s.email}`.toLowerCase().includes(needle))
    : students;

  function toggle(list: string[], value: string, checked: boolean) {
    return checked ? [...new Set([...list, value])] : list.filter((item) => item !== value);
  }

  function addGroup(group: StudentGroup) {
    setSelectedStudents((current) => [...new Set([...current, ...group.memberIds.filter((id) => activeIds.has(id))])]);
  }

  async function saveGroup() {
    setGroupMessage("");
    const response = await fetch("/api/admin/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: groupName, kind: groupKind, personIds: selectedStudents }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setGroupMessage(body.error || "The group didn't save.");
      return;
    }
    setGroupMessage(body.replaced ? `Updated "${groupName}".` : `Saved "${groupName}".`);
    setGroupName("");
    router.refresh();
  }

  async function deleteGroup(group: StudentGroup) {
    const response = await fetch(`/api/admin/groups/${group.id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  function applyTemplate(task: TaskSummary) {
    setTitle(`${task.title} (copy)`);
    setBrief(task.brief);
    setMediaType(task.mediaType);
    setOrientation(task.orientation);
    setMinCount(task.minMediaCount);
    setMaxCount(task.maxMediaCount);
    setMinDuration(task.minDurationSeconds ?? 5);
    setMaxDuration(task.maxDurationSeconds ?? 30);
    setCaptionRequired(task.captionRequired);
    setSelectedGuidelines(task.guidelineSetIds);
    setMessage("Copied into the form. Choose dates and students, then create it.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setSkipped([]);
    const response = await fetch("/api/admin/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignId, title, brief, mediaType, orientation, startsOn, endsOn, weekdaysOnly,
        studentIds: selectedStudents,
        guidelineSetIds: selectedGuidelines,
        minMediaCount: mediaType === "photo_series" ? minCount : 1,
        maxMediaCount: mediaType === "photo_series" ? maxCount : 1,
        minDurationSeconds: mediaType === "video" ? minDuration : null,
        maxDurationSeconds: mediaType === "video" ? maxDuration : null,
        captionRequired,
      }),
    });
    const body = await response.json().catch(() => ({ error: "The task could not be created." }));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "The task could not be created.");
      return;
    }
    setMessage(`Task created: ${body.createdAssignments} assignment${body.createdAssignments === 1 ? "" : "s"}.`);
    setSkipped(body.skipped ?? []);
    setTitle("");
    setBrief("");
    router.refresh();
  }

  const selectedCount = selectedStudents.length;
  const assignmentEstimate = days ? days.length * selectedCount : 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">School administrator</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Content tasks</h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
            Create one task for a day, or repeat it across school days. A student gets at most one task per date.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link className="underline" href="/admin/campaigns">Campaigns</Link>
          <Link className="underline" href="/admin/guidelines">Checklists</Link>
        </div>
      </header>

      <form onSubmit={submit} className="card space-y-6 p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-2 sm:col-span-2"><span className="label">Task title</span><input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={field} style={{ borderColor: "var(--rule)" }} placeholder="Hallway energy between classes" /></label>
          <label className="space-y-2 sm:col-span-2"><span className="label">What students should capture</span><textarea required minLength={10} maxLength={2000} rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} className={field} style={{ borderColor: "var(--rule)" }} placeholder="Stand in one safe place and capture…" /></label>
          <label className="space-y-2"><span className="label">Campaign</span><select required value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={field} style={{ borderColor: "var(--rule)" }}><option value="">Choose campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>{campaigns.length === 0 && <span className="block text-xs" style={{ color: "var(--clay)" }}>No active campaigns. <Link className="underline" href="/admin/campaigns">Create one</Link> first.</span>}</label>
          <label className="space-y-2"><span className="label">Media</span><select value={mediaType} onChange={(e) => { const value = e.target.value as PromptMediaType; setMediaType(value); if (value !== "photo_series") { setMinCount(1); setMaxCount(1); } }} className={field} style={{ borderColor: "var(--rule)" }}><option value="photo">One photo</option><option value="photo_series">Photo series</option><option value="video">Video</option></select></label>
          <label className="space-y-2"><span className="label">Orientation</span><select value={orientation} onChange={(e) => setOrientation(e.target.value as PromptOrientation)} className={field} style={{ borderColor: "var(--rule)" }}><option value="any">Any</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option></select></label>
          {mediaType === "photo_series" && <div className="grid grid-cols-2 gap-3"><label className="space-y-2"><span className="label">Min photos</span><input type="number" min={1} max={4} value={minCount} onChange={(e) => setMinCount(Number(e.target.value))} className={field} style={{ borderColor: "var(--rule)" }} /></label><label className="space-y-2"><span className="label">Max photos</span><input type="number" min={1} max={4} value={maxCount} onChange={(e) => setMaxCount(Number(e.target.value))} className={field} style={{ borderColor: "var(--rule)" }} /></label></div>}
          {mediaType === "video" && <div className="grid grid-cols-2 gap-3"><label className="space-y-2"><span className="label">Min seconds</span><input type="number" min={0} max={600} value={minDuration} onChange={(e) => setMinDuration(Number(e.target.value))} className={field} style={{ borderColor: "var(--rule)" }} /></label><label className="space-y-2"><span className="label">Max seconds</span><input type="number" min={1} max={600} value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value))} className={field} style={{ borderColor: "var(--rule)" }} /></label></div>}
          <label className="space-y-2"><span className="label">First day</span><input type="date" required value={startsOn} onChange={(e) => { setStartsOn(e.target.value); if (endsOn < e.target.value) setEndsOn(e.target.value); }} className={field} style={{ borderColor: "var(--rule)" }} /></label>
          <label className="space-y-2"><span className="label">Last day</span><input type="date" required min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={field} style={{ borderColor: "var(--rule)" }} /></label>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} /> Weekdays only</label>
            <span className="text-sm" style={{ color: days && days.length ? "var(--muted)" : "var(--clay)" }}>
              {days === null ? "Choose a range of 31 days or fewer." : days.length === 0 ? "No days in that range." : `${days.length} day${days.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="label mb-1">Students · {selectedCount} selected{assignmentEstimate ? ` · ${assignmentEstimate} assignments` : ""}</legend>
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm" style={{ color: "var(--muted)" }}>Add a group:</span>
              {groups.map((group) => (
                <span key={group.id} className="inline-flex items-center rounded-sm border text-sm" style={{ borderColor: "var(--rule)" }}>
                  <button type="button" className="px-2 py-1" onClick={() => addGroup(group)} title={`${KIND_LABEL[group.kind] ?? "List"} · ${group.memberIds.length} students`}>
                    {group.name} <span className="font-mono text-xs opacity-60">{group.memberIds.length}</span>
                  </button>
                  <button type="button" className="border-l px-1.5 py-1 text-xs" style={{ borderColor: "var(--rule)", color: "var(--muted)" }} aria-label={`Delete group ${group.name}`} onClick={() => void deleteGroup(group)}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <input value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Search students" aria-label="Search students" className="min-w-0 flex-1 rounded border bg-transparent px-3 py-2 sm:max-w-xs" style={{ borderColor: "var(--rule)" }} />
            <button type="button" className="underline" onClick={() => setSelectedStudents((current) => [...new Set([...current, ...shownStudents.filter((s) => activeIds.has(s.id)).map((s) => s.id)])])}>
              {needle ? "Select these" : "Select all active"}
            </button>
            <button type="button" className="underline" onClick={() => setSelectedStudents([])}>Clear</button>
          </div>
          <div className="grid max-h-[28rem] gap-2 overflow-y-auto sm:grid-cols-2">
            {shownStudents.map((student) => <label key={student.id} className="flex items-start gap-3 rounded border p-3" style={{ borderColor: "var(--rule)", opacity: student.participation === "active" ? 1 : 0.55 }}><input type="checkbox" className="mt-1" disabled={student.participation !== "active"} checked={selectedStudents.includes(student.id)} onChange={(e) => setSelectedStudents((current) => toggle(current, student.id, e.target.checked))} /><span><span className="block font-medium">{student.display_name}</span><span className="block text-xs" style={{ color: "var(--muted)" }}>{student.email}{student.participation !== "active" ? ` · ${student.participation === "pending" ? "not activated" : "access revoked"}` : ""}</span>{student.participation === "pending" && <a href="/admin/people" className="mt-1 block text-xs underline">Activate in People</a>}</span></label>)}
          </div>
          {students.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>Nobody on the roster yet. <Link className="underline" href="/admin/people">Add students in People</Link>.</p>}
          {selectedCount > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span style={{ color: "var(--muted)" }}>Save these {selectedCount} as</span>
              <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Varsity soccer" aria-label="Group name" className="rounded border bg-transparent px-2 py-1" style={{ borderColor: "var(--rule)" }} />
              <select value={groupKind} onChange={(e) => setGroupKind(e.target.value)} aria-label="Group kind" className="rounded border bg-transparent px-2 py-1" style={{ borderColor: "var(--rule)" }}>
                <option value="team">a team</option>
                <option value="grade">a grade</option>
                <option value="program">a program</option>
                <option value="list">a saved list</option>
              </select>
              <button type="button" className="btn btn-quiet" disabled={!groupName.trim()} onClick={() => void saveGroup()}>Save group</button>
              {groupMessage && <span>{groupMessage}</span>}
            </div>
          )}
        </fieldset>

        {guidelineSets.length > 0 && <fieldset><legend className="label mb-3">Capture checklist</legend><div className="grid gap-2 sm:grid-cols-2">{guidelineSets.map((set) => <div key={set.id} className="rounded border p-3" style={{ borderColor: "var(--rule)" }}><label className="flex gap-3"><input type="checkbox" checked={selectedGuidelines.includes(set.id)} onChange={(e) => setSelectedGuidelines((current) => toggle(current, set.id, e.target.checked))} /><span><span className="block font-medium">{set.name}</span><span className="label">{set.kind}</span></span></label>{(guidelineText[set.id]?.length ?? 0) > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer" style={{ color: "var(--muted)" }}>What students see ({guidelineText[set.id]!.length})</summary><ul className="mt-1 list-disc pl-5">{guidelineText[set.id]!.map((line) => <li key={line}>{line}</li>)}</ul></details>}</div>)}</div></fieldset>}

        <label className="flex items-center gap-3"><input type="checkbox" checked={captionRequired} onChange={(e) => setCaptionRequired(e.target.checked)} /><span>Require a short caption from the student</span></label>
        {error && <p role="alert" className="text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
        {message && (
          <div role="status" className="text-sm" style={{ color: "var(--moss)" }}>
            <p>{message}</p>
            {skipped.length > 0 && (
              <p className="mt-1" style={{ color: "var(--ink)" }}>
                Skipped because they already have a task that day:{" "}
                {skipped.slice(0, 12).map((s) => `${s.name} (${s.dueOn})`).join(", ")}
                {skipped.length > 12 ? `, and ${skipped.length - 12} more` : ""}.
              </p>
            )}
          </div>
        )}
        <button className="btn w-full sm:w-auto" disabled={busy || !campaignId || selectedCount === 0 || !days?.length}>{busy ? "Creating…" : days && days.length > 1 ? `Create ${days.length} days of tasks` : "Create task"}</button>
      </form>

      <section>
        <h2 className="text-xl font-semibold">Tasks</h2>
        <div className="mt-4 grid gap-3">{tasks.map((task) => {
          const due = task.dueCount ?? 0;
          const sent = task.sentCount ?? 0;
          return (
            <article key={task.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="label">{task.campaign} · {task.mediaType.replace("_", " ")} · {task.orientation}</p>
                  <h3 className="mt-1 text-lg font-semibold"><Link href={`/admin/tasks/${task.id}`} className="underline-offset-4 hover:underline">{task.title}</Link></h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {task.cancelled ? <Chip tone="bad">Cancelled</Chip> : !task.active ? <Chip tone="accent">Paused</Chip> : null}
                    <Chip tone={due && sent === due ? "good" : "muted"}>{due ? `${sent} of ${due} sent` : "Not due yet"}</Chip>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{task.assignmentCount} assignment{task.assignmentCount === 1 ? "" : "s"}{task.firstDueOn ? ` · ${task.firstDueOn}${task.lastDueOn !== task.firstDueOn ? ` to ${task.lastDueOn}` : ""}` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link className="btn" href={`/admin/tasks/${task.id}`}>Open</Link>
                  <button type="button" className="btn btn-quiet" onClick={() => applyTemplate(task)}>Use as template</button>
                </div>
              </div>
            </article>
          );
        })}{tasks.length === 0 && <div className="card p-5 text-sm" style={{ color: "var(--muted)" }}>No tasks yet.</div>}</div>
      </section>
    </div>
  );
}
