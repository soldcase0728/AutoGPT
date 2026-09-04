"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PromptMediaType, PromptOrientation } from "@/lib/types";

interface Campaign { id: string; name: string; starts_on: string; ends_on: string | null }
interface Student { id: string; display_name: string; email: string; participation: string }
interface GuidelineSet { id: string; name: string; kind: string }

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
  assignmentCount: number;
  firstDueOn: string | null;
  lastDueOn: string | null;
}

export function TaskManager({ today, campaigns, students, guidelineSets, tasks }: {
  today: string;
  campaigns: Campaign[];
  students: Student[];
  guidelineSets: GuidelineSet[];
  tasks: TaskSummary[];
}) {
  const router = useRouter();
  const activeStudents = useMemo(() => students.filter((student) => student.participation === "active"), [students]);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [mediaType, setMediaType] = useState<PromptMediaType>("photo");
  const [orientation, setOrientation] = useState<PromptOrientation>("any");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [selectedGuidelines, setSelectedGuidelines] = useState(() => guidelineSets.filter((set) => set.kind === "brand").map((set) => set.id));
  const [minCount, setMinCount] = useState(1);
  const [maxCount, setMaxCount] = useState(1);
  const [minDuration, setMinDuration] = useState(5);
  const [maxDuration, setMaxDuration] = useState(30);
  const [captionRequired, setCaptionRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function toggle(list: string[], value: string, checked: boolean) {
    return checked ? [...new Set([...list, value])] : list.filter((item) => item !== value);
  }

  function applyTemplate(task: TaskSummary) {
    setTitle(`${task.title} — copy`);
    setBrief(task.brief);
    setMediaType(task.mediaType);
    setOrientation(task.orientation);
    setMinCount(task.minMediaCount);
    setMaxCount(task.maxMediaCount);
    setMinDuration(task.minDurationSeconds ?? 5);
    setMaxDuration(task.maxDurationSeconds ?? 30);
    setCaptionRequired(task.captionRequired);
    setSelectedGuidelines(task.guidelineSetIds);
    setMessage("Template copied into the form. Choose dates and students, then create it.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/admin/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignId, title, brief, mediaType, orientation, startsOn, endsOn,
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
    setMessage(`Task created: ${body.createdAssignments} assignment${body.createdAssignments === 1 ? "" : "s"}.${body.skippedExisting ? ` ${body.skippedExisting} student/date slot${body.skippedExisting === 1 ? " was" : "s were"} already occupied and skipped.` : ""}`);
    setTitle("");
    setBrief("");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="label">School administrator</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Content tasks</h1>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
          Create one task for a day, or repeat it across a week. A student can receive only one assigned task per date.
        </p>
      </header>

      <form onSubmit={submit} className="card space-y-6 p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-2 sm:col-span-2"><span className="label">Task title</span><input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} placeholder="Hallway energy between classes" /></label>
          <label className="space-y-2 sm:col-span-2"><span className="label">What students should capture</span><textarea required minLength={10} maxLength={2000} rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} placeholder="Stand in one safe place and capture…" /></label>
          <label className="space-y-2"><span className="label">Campaign</span><select required value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }}><option value="">Choose campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
          <label className="space-y-2"><span className="label">Media</span><select value={mediaType} onChange={(e) => { const value = e.target.value as PromptMediaType; setMediaType(value); if (value !== "photo_series") { setMinCount(1); setMaxCount(1); } }} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }}><option value="photo">One photo</option><option value="photo_series">Photo series</option><option value="video">Video</option></select></label>
          <label className="space-y-2"><span className="label">Orientation</span><select value={orientation} onChange={(e) => setOrientation(e.target.value as PromptOrientation)} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }}><option value="any">Any</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option></select></label>
          {mediaType === "photo_series" && <div className="grid grid-cols-2 gap-3"><label className="space-y-2"><span className="label">Min photos</span><input type="number" min={1} max={4} value={minCount} onChange={(e) => setMinCount(Number(e.target.value))} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} /></label><label className="space-y-2"><span className="label">Max photos</span><input type="number" min={1} max={4} value={maxCount} onChange={(e) => setMaxCount(Number(e.target.value))} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} /></label></div>}
          {mediaType === "video" && <div className="grid grid-cols-2 gap-3"><label className="space-y-2"><span className="label">Min seconds</span><input type="number" min={0} max={600} value={minDuration} onChange={(e) => setMinDuration(Number(e.target.value))} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} /></label><label className="space-y-2"><span className="label">Max seconds</span><input type="number" min={1} max={600} value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value))} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} /></label></div>}
          <label className="space-y-2"><span className="label">First day</span><input type="date" required value={startsOn} onChange={(e) => { setStartsOn(e.target.value); if (endsOn < e.target.value) setEndsOn(e.target.value); }} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} /></label>
          <label className="space-y-2"><span className="label">Last day</span><input type="date" required min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="w-full rounded border bg-transparent px-3 py-3" style={{ borderColor: "var(--rule)" }} /></label>
        </div>

        <fieldset><legend className="label mb-3">Students</legend><div className="mb-3 flex gap-3 text-sm"><button type="button" className="underline" onClick={() => setSelectedStudents(activeStudents.map((student) => student.id))}>Select all active</button><button type="button" className="underline" onClick={() => setSelectedStudents([])}>Clear</button></div><div className="grid gap-2 sm:grid-cols-2">{students.map((student) => <label key={student.id} className="flex items-start gap-3 rounded border p-3" style={{ borderColor: "var(--rule)", opacity: student.participation === "active" ? 1 : 0.55 }}><input type="checkbox" className="mt-1" disabled={student.participation !== "active"} checked={selectedStudents.includes(student.id)} onChange={(e) => setSelectedStudents((current) => toggle(current, student.id, e.target.checked))} /><span><span className="block font-medium">{student.display_name}</span><span className="block text-xs" style={{ color: "var(--muted)" }}>{student.email}{student.participation !== "active" ? ` · ${student.participation}` : ""}</span></span></label>)}</div>{students.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>Add students to the roster before scheduling tasks.</p>}</fieldset>

        {guidelineSets.length > 0 && <fieldset><legend className="label mb-3">Capture checklist</legend><div className="grid gap-2 sm:grid-cols-2">{guidelineSets.map((set) => <label key={set.id} className="flex gap-3 rounded border p-3" style={{ borderColor: "var(--rule)" }}><input type="checkbox" checked={selectedGuidelines.includes(set.id)} onChange={(e) => setSelectedGuidelines((current) => toggle(current, set.id, e.target.checked))} /><span><span className="block font-medium">{set.name}</span><span className="label">{set.kind}</span></span></label>)}</div></fieldset>}

        <label className="flex items-center gap-3"><input type="checkbox" checked={captionRequired} onChange={(e) => setCaptionRequired(e.target.checked)} /><span>Require a short caption from the student</span></label>
        {error && <p role="alert" className="text-sm" style={{ color: "var(--clay)" }}>{error}</p>}
        {message && <p role="status" className="text-sm" style={{ color: "var(--moss)" }}>{message}</p>}
        <button className="btn w-full sm:w-auto" disabled={busy || !campaignId || selectedStudents.length === 0}>{busy ? "Creating…" : startsOn === endsOn ? "Create daily task" : "Create scheduled tasks"}</button>
      </form>

      <section>
        <h2 className="text-xl font-semibold">Recent task prompts</h2>
        <div className="mt-4 grid gap-3">{tasks.map((task) => <article key={task.id} className="card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="label">{task.campaign} · {task.mediaType.replace("_", " ")} · {task.orientation}</p><h3 className="mt-1 text-lg font-semibold">{task.title}</h3><p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{task.brief}</p><p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>{task.assignmentCount} assignment{task.assignmentCount === 1 ? "" : "s"}{task.firstDueOn ? ` · ${task.firstDueOn}${task.lastDueOn !== task.firstDueOn ? ` to ${task.lastDueOn}` : ""}` : ""}</p></div><button type="button" className="btn btn-quiet shrink-0" onClick={() => applyTemplate(task)}>Use as template</button></div></article>)}{tasks.length === 0 && <div className="card p-5 text-sm" style={{ color: "var(--muted)" }}>No task prompts yet.</div>}</div>
      </section>
    </div>
  );
}
