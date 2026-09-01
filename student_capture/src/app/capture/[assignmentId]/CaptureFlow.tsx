"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { checklistSatisfied, requiredIds, type Checklist } from "@/lib/guidelines";
import { blocks, checkFormat, formatBytes, type FormatFinding } from "@/lib/format-spec";
import { mediaKind, probeMedia, type Probe } from "@/lib/probe";
import type { FormatSpec } from "@/lib/types";
import { Chip } from "@/components/Chip";

// Supabase's resumable endpoint requires exactly this chunk size.
const CHUNK_SIZE = 6 * 1024 * 1024;

type UploadState = "idle" | "uploading" | "done" | "failed";

interface Props {
  assignmentId: string;
  spec: FormatSpec;
  checklist: Checklist;
  people: Array<{ id: string; display_name: string }>;
  self: { id: string; display_name: string };
  maxBytes: number;
  supabaseUrl: string;
}

export function CaptureFlow({
  assignmentId,
  spec,
  checklist,
  people,
  self,
  maxBytes,
  supabaseUrl,
}: Props) {
  const router = useRouter();
  const uploadRef = useRef<tus.Upload | null>(null);

  const [ticked, setTicked] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<Probe>({});
  const [findings, setFindings] = useState<FormatFinding[]>([]);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [oneLiner, setOneLiner] = useState("");
  const [tagged, setTagged] = useState<string[]>([]);
  const [nobody, setNobody] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const required = useMemo(() => requiredIds(checklist), [checklist]);
  const ready = checklistSatisfied(checklist, ticked);
  const peopleDecided = nobody ? tagged.length === 0 : tagged.length > 0;
  const canSubmit =
    upload === "done" && oneLiner.trim().length > 0 && peopleDecided && !submitting;

  const startUpload = useCallback(
    async (chosen: File) => {
      setError("");
      setUpload("uploading");
      setProgress(0);

      const started = await fetch("/api/uploads/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignmentId,
          filename: chosen.name,
          mime: chosen.type,
          bytes: chosen.size,
          kind: mediaKind(chosen),
        }),
      });

      if (!started.ok) {
        const body = await started.json().catch(() => ({ error: "Upload could not start." }));
        setUpload("failed");
        setError(body.error ?? "Upload could not start.");
        return;
      }

      const { captureId: id, bucket, objectName } = await started.json();
      setCaptureId(id);

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setUpload("failed");
        setError("Your session expired. Sign in again and the file is still on your phone.");
        return;
      }

      const tusUpload = new tus.Upload(chosen, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        // Campus wifi and LTE both drop. Back off and keep going rather than
        // making the student start over.
        retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "x-upsert": "false",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: CHUNK_SIZE,
        metadata: {
          bucketName: bucket,
          objectName,
          contentType: chosen.type || "application/octet-stream",
          cacheControl: "3600",
        },
        onProgress: (sent, total) => setProgress(total ? sent / total : 0),
        onError: (err) => {
          setUpload("failed");
          setError(err.message || "The upload stopped. Tap retry — it resumes where it left off.");
        },
        onSuccess: () => {
          setProgress(1);
          setUpload("done");
        },
      });

      uploadRef.current = tusUpload;
      const previous = await tusUpload.findPreviousUploads();
      if (previous.length > 0 && previous[0]) {
        tusUpload.resumeFromPreviousUpload(previous[0]);
      }
      tusUpload.start();
    },
    [assignmentId, supabaseUrl],
  );

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;

    const facts = await probeMedia(chosen);
    const result = checkFormat(
      spec,
      { kind: mediaKind(chosen), bytes: chosen.size, ...facts },
      maxBytes,
    );

    setFile(chosen);
    setProbe(facts);
    setFindings(result);

    // Warnings are advice, not a wall — only a blocking finding stops the upload.
    if (!blocks(result)) void startUpload(chosen);
    else setUpload("idle");
  }

  async function submit() {
    if (!captureId) return;
    setSubmitting(true);
    setError("");

    const response = await fetch(`/api/captures/${captureId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        oneLiner,
        peopleIds: tagged,
        noPeopleInFrame: nobody,
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        checklistTicked: ticked,
        guidelineVersionIds: checklist.versionIds,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Could not send that." }));
      setSubmitting(false);
      setError(body.error ?? "Could not send that.");
      return;
    }

    router.push("/submissions");
    router.refresh();
  }

  function toggle(id: string) {
    setTagged((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
    setNobody(false);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 1 — the rules, at the moment they matter */}
      <section className="card p-5">
        <p className="label">Tick these off</p>
        <ul className="mt-3 flex flex-col gap-3">
          {checklist.items.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-3 text-[15px]">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={ticked.includes(item.id)}
                  onChange={(e) =>
                    setTicked((prev) =>
                      e.target.checked
                        ? [...prev, item.id]
                        : prev.filter((t) => t !== item.id),
                    )
                  }
                />
                <span>
                  {item.text}
                  {!item.required && (
                    <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                      optional
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {!ready && required.length > 0 && (
          <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
            Tick the required lines to unlock the camera.
          </p>
        )}
      </section>

      {/* 2 — the camera */}
      <section className="card p-5">
        <p className="label">The shot</p>
        <label
          className={`btn mt-3 block cursor-pointer text-center ${ready ? "" : "pointer-events-none opacity-40"}`}
        >
          {file ? "Choose a different file" : "Open camera"}
          <input
            type="file"
            className="sr-only"
            accept={spec.kind === "photo" ? "image/*" : "video/*"}
            capture="environment"
            disabled={!ready}
            onChange={onPick}
          />
        </label>

        {file && (
          <div className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Chip>{formatBytes(file.size)}</Chip>
              {probe.durationSeconds && <Chip>{Math.round(probe.durationSeconds)}s</Chip>}
              {probe.width && probe.height && (
                <Chip>
                  {probe.width}×{probe.height}
                </Chip>
              )}
            </div>
            {findings.map((finding, i) => (
              <p
                key={i}
                style={{ color: finding.level === "block" ? "var(--clay)" : "var(--accent)" }}
              >
                {finding.message}
              </p>
            ))}
          </div>
        )}

        {upload !== "idle" && (
          <div className="mt-4">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--sunk)" }}
            >
              <div
                className="h-full transition-[width] duration-200"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  background: upload === "failed" ? "var(--clay)" : "var(--accent)",
                }}
              />
            </div>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {upload === "uploading" &&
                `Uploading ${Math.round(progress * 100)}% — keep this screen open.`}
              {upload === "done" && "Uploaded. Now tell us what it is."}
              {upload === "failed" && "Upload stopped."}
            </p>
            {upload === "failed" && file && (
              <button
                className="btn btn-quiet mt-3"
                onClick={() => void startUpload(file)}
                type="button"
              >
                Retry — it picks up where it stopped
              </button>
            )}
          </div>
        )}
      </section>

      {/* 3 — the context marketing needs, and nothing more */}
      <section className="card p-5">
        <label className="label" htmlFor="one-liner">
          What is happening? One line.
        </label>
        <input
          id="one-liner"
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          maxLength={140}
          className="card mt-2 w-full px-3 py-3"
          style={{ background: "var(--bg)" }}
          placeholder="Last five minutes before the bus leaves"
        />

        <p className="label mt-5">Who is in it?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[{ id: self.id, display_name: `${self.display_name} (you)` }, ...people.filter((p) => p.id !== self.id)].map(
            (p) => {
              const on = tagged.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="rounded-sm border px-3 py-1.5 text-sm"
                  style={{
                    borderColor: on ? "var(--ink)" : "var(--rule)",
                    background: on ? "var(--ink)" : "transparent",
                    color: on ? "var(--bg)" : "var(--ink)",
                  }}
                  aria-pressed={on}
                >
                  {p.display_name}
                </button>
              );
            },
          )}
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3 text-[15px]">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0"
            checked={nobody}
            onChange={(e) => {
              setNobody(e.target.checked);
              if (e.target.checked) setTagged([]);
            }}
          />
          <span>Nobody is recognisable in this one.</span>
        </label>
        {!peopleDecided && (
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Tag everyone we could recognise, or tick the box. We cannot post it
            otherwise.
          </p>
        )}
      </section>

      <button className="btn" disabled={!canSubmit} onClick={submit} type="button">
        {submitting ? "Sending…" : "Send it"}
      </button>
      {error && (
        <p className="text-sm" style={{ color: "var(--clay)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
