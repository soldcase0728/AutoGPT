"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { safetyItems, type Checklist } from "@/lib/guidelines";
import { blocks, checkFormat, formatBytes, type FormatFinding } from "@/lib/format-spec";
import { mediaKind, probeMedia, probeUrl, type Probe } from "@/lib/probe";
import {
  UploadStepError,
  describeUploadFailure,
  sendBlockers,
  type UploadState,
} from "@/lib/capture-status";
import type { FormatSpec, PromptMediaType, PromptOrientation } from "@/lib/types";
import { Chip } from "@/components/Chip";
import { SafetyReport } from "@/components/SafetyReport";
import { PhotoCamera } from "./PhotoCamera";

// Supabase's resumable endpoint requires exactly this chunk size.
const CHUNK_SIZE = 6 * 1024 * 1024;

type MediaMetadata = {
  id: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType: string;
  fileSize: number;
};

/** An earlier attempt at this assignment that never reached "Send it". */
export interface ResumeState {
  captureId: string;
  startedAt: string;
  /** A reshoot of something already sent once. It cannot be thrown away and restarted. */
  isResubmission: boolean;
  /** Every file landed; only the details and "Send it" are left. */
  complete: boolean;
  media: Array<{
    id: string;
    kind: "photo" | "video";
    mimeType: string;
    fileSize: number;
    clientMediaId: string | null;
  }>;
}

interface Props {
  assignmentId: string;
  initialCaptureId?: string;
  resume?: ResumeState;
  ideaId?: string;
  spec: FormatSpec;
  mediaType: PromptMediaType;
  orientation: PromptOrientation;
  minMediaCount: number;
  maxMediaCount: number;
  captionRequired: boolean;
  checklist: Checklist;
  people: Array<{ id: string; display_name: string }>;
  self: { id: string; display_name: string };
  maxBytes: number;
  supabaseUrl: string;
}

function mediaUrl(captureId: string, mediaId: string) {
  return `/api/captures/${captureId}/media?mediaId=${mediaId}`;
}

export function CaptureFlow({
  assignmentId,
  initialCaptureId,
  resume,
  ideaId,
  spec,
  mediaType,
  orientation,
  minMediaCount,
  maxMediaCount,
  captionRequired,
  checklist,
  people,
  self,
  maxBytes,
  supabaseUrl,
}: Props) {
  const router = useRouter();
  const storageKey = `student-capture:pending:${assignmentId}`;
  const identityRef = useRef<{ submissionId: string; mediaIds: string[] } | null>(null);
  const lastFilesRef = useRef<File[]>([]);
  const resumedComplete = Boolean(resume?.complete);
  // A fresh attempt that never finished uploading is replaced, not continued.
  const staleRef = useRef<string | null>(
    resume && !resume.complete && !resume.isResubmission ? resume.captureId : null,
  );

  const [resumed, setResumed] = useState(resumedComplete);
  const [safetyAck, setSafetyAck] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [cameraKey, setCameraKey] = useState(0);
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadata[]>(
    resumedComplete
      ? resume!.media.map((m) => ({ id: m.id, mimeType: m.mimeType, fileSize: m.fileSize }))
      : [],
  );
  const [probe, setProbe] = useState<Probe>({});
  const [findings, setFindings] = useState<FormatFinding[]>([]);
  const [captureId, setCaptureId] = useState<string | null>(
    resumedComplete ? resume!.captureId : (initialCaptureId ?? null),
  );
  const [upload, setUpload] = useState<UploadState>(resumedComplete ? "done" : "idle");
  const [progress, setProgress] = useState(resumedComplete ? 1 : 0);
  const [uploadError, setUploadError] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [tagged, setTagged] = useState<string[]>([]);
  const [nobody, setNobody] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const safety = useMemo(() => safetyItems(checklist), [checklist]);
  const tips = useMemo(() => checklist.items.filter((i) => !i.safety), [checklist]);
  // One acknowledgement covers every safety rule; the tips are for reading.
  const ready = safety.length === 0 || safetyAck;
  const peopleDecided = nobody ? tagged.length === 0 : tagged.length > 0;
  const blockers = sendBlockers({ upload, captionRequired, oneLiner, peopleDecided });
  const canSubmit = blockers.length === 0 && !submitting;
  // A reshoot keeps its submission, so once its files land they stay.
  const canReplace = !initialCaptureId;

  // Media resumed from an earlier visit still needs its facts read for "Send it".
  useEffect(() => {
    if (!resumedComplete || !resume) return;
    let cancelled = false;
    void Promise.all(
      resume.media.map((m) => probeUrl(mediaUrl(resume.captureId, m.id), m.kind)),
    ).then((facts) => {
      if (cancelled) return;
      setProbe(facts[0] ?? {});
      setMediaMetadata((current) =>
        current.map((item, index) => ({ ...item, ...facts[index] })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [resume, resumedComplete]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const pendingIdentity = useCallback((mediaCount: number) => {
    if (!identityRef.current) {
      if (resume?.isResubmission) {
        // Retrying a reshoot must reuse the media rows it already reserved.
        identityRef.current = {
          submissionId: resume.captureId,
          mediaIds: resume.media.flatMap((m) => (m.clientMediaId ? [m.clientMediaId] : [])),
        };
      } else {
        try {
          const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as {
            submissionId?: string;
            mediaIds?: string[];
          } | null;
          if (saved?.submissionId && Array.isArray(saved.mediaIds) && !staleRef.current) {
            identityRef.current = { submissionId: saved.submissionId, mediaIds: saved.mediaIds };
          }
        } catch {
          // A malformed local hint is safe to replace; the server still owns
          // uniqueness and authorization.
        }
      }
      identityRef.current ??= { submissionId: crypto.randomUUID(), mediaIds: [] };
    }
    while (identityRef.current.mediaIds.length < mediaCount) {
      identityRef.current.mediaIds.push(crypto.randomUUID());
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(identityRef.current));
    } catch {
      // Private browsing: retries still work within this visit.
    }
    return identityRef.current;
  }, [resume, storageKey]);

  /** Withdraw an attempt the student is replacing, so it doesn't linger in "Yours". */
  const discardAttempt = useCallback(async (id: string) => {
    await fetch(`/api/captures/${id}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Replaced with a new shot before sending." }),
    }).catch(() => undefined);
    identityRef.current = null;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing stored.
    }
  }, [storageKey]);

  const startUpload = useCallback(
    async (chosenFiles: File[]) => {
      lastFilesRef.current = chosenFiles;
      setError("");
      setUploadError("");
      setUpload("uploading");
      setProgress(0);

      try {
        if (staleRef.current) {
          await discardAttempt(staleRef.current);
          staleRef.current = null;
        }

        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new UploadStepError("Sign in first.", 401);

        let submissionId: string | null = initialCaptureId ?? null;
        const metadata: MediaMetadata[] = [];
        const identity = pendingIdentity(chosenFiles.length);
        for (let index = 0; index < chosenFiles.length; index += 1) {
          const chosen = chosenFiles[index]!;
          const facts = await probeMedia(chosen);
          const started: Response = await fetch("/api/uploads/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              assignmentId,
              clientSubmissionId: identity.submissionId,
              clientMediaId: identity.mediaIds[index],
              captureId: submissionId ?? undefined,
              filename: chosen.name,
              mime: chosen.type,
              bytes: chosen.size,
              kind: mediaKind(chosen),
            }),
          });
          if (!started.ok) {
            const body = await started.json().catch(() => ({ error: "" }));
            throw new UploadStepError(body.error || "The upload could not start.", started.status);
          }
          const reservation = (await started.json()) as {
            captureId: string;
            mediaId: string;
            bucket: string;
            objectName: string;
          };
          submissionId = reservation.captureId;
          setCaptureId(submissionId);

          await new Promise<void>((resolve, reject) => {
            const tusUpload = new tus.Upload(chosen, {
              endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
              retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
              headers: { authorization: `Bearer ${session.access_token}`, "x-upsert": "false" },
              uploadDataDuringCreation: true,
              removeFingerprintOnSuccess: true,
              chunkSize: CHUNK_SIZE,
              metadata: {
                bucketName: reservation.bucket,
                objectName: reservation.objectName,
                contentType: chosen.type || "application/octet-stream",
                cacheControl: "3600",
              },
              onProgress: (sent, total) =>
                setProgress((index + (total ? sent / total : 0)) / chosenFiles.length),
              onError: reject,
              onSuccess: () => resolve(),
            });
            void tusUpload.findPreviousUploads().then((previous) => {
              if (previous[0]) tusUpload.resumeFromPreviousUpload(previous[0]);
              tusUpload.start();
            }, reject);
          });
          metadata.push({
            id: reservation.mediaId,
            width: facts.width,
            height: facts.height,
            durationSeconds: facts.durationSeconds,
            mimeType: chosen.type,
            fileSize: chosen.size,
          });
        }
        setMediaMetadata(metadata);
        setProgress(1);
        setUpload("done");
      } catch (cause) {
        const largest = Math.max(0, ...chosenFiles.map((f) => f.size));
        setUpload("failed");
        setUploadError(
          describeUploadFailure(cause, {
            online: typeof navigator === "undefined" ? true : navigator.onLine,
            fileBytes: largest || undefined,
            maxBytes,
          }).message,
        );
      }
    },
    [assignmentId, discardAttempt, initialCaptureId, maxBytes, pendingIdentity, supabaseUrl],
  );

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;

    const facts = await probeMedia(chosen);
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
    setProbe(facts);
    setFindings(checkFormat(spec, { kind: mediaKind(chosen), bytes: chosen.size, ...facts }, maxBytes));
    setUpload("idle");
    setUploadError("");
  }

  /** Throw away the current shot and go back to the camera. */
  async function replace() {
    if (captureId && canReplace && (upload === "done" || upload === "failed")) {
      setUpload("uploading");
      await discardAttempt(captureId);
      setCaptureId(null);
    }
    staleRef.current = null;
    setResumed(false);
    setFile(null);
    setPreviewUrl(null);
    setProbe({});
    setFindings([]);
    setPhotoFiles([]);
    setMediaMetadata([]);
    setCameraKey((k) => k + 1);
    setUpload("idle");
    setProgress(0);
    setUploadError("");
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
        media: mediaMetadata,
        // Only what the student actually confirmed: the safety acknowledgement.
        checklistTicked: safetyAck ? safety.map((item) => item.id) : [],
        guidelineVersionIds: checklist.versionIds,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "" }));
      setSubmitting(false);
      setError(
        response.status === 401
          ? "You were signed out. Sign in again in a new tab, then tap Send it again."
          : body.error || "That didn't send. Tap Send it again.",
      );
      return;
    }

    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing stored.
    }
    router.push("/submissions");
    router.refresh();
  }

  function toggle(id: string) {
    setTagged((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setNobody(false);
  }

  const blocking = blocks(findings);
  const shotLocked = upload === "uploading" || upload === "done";

  return (
    <div className="flex flex-col gap-5">
      {resume && !resume.complete && (
        <p className="card p-4 text-[15px]" style={{ borderColor: "var(--accent)" }}>
          Your last try at this, from {new Date(resume.startedAt).toLocaleString()}, didn&rsquo;t
          finish uploading. Choose the shot again to send it.
        </p>
      )}
      {resumed && (
        <p className="card p-4 text-[15px]" style={{ borderColor: "var(--moss)" }}>
          Your shot from {new Date(resume!.startedAt).toLocaleString()} is uploaded. Add the
          details below and tap Send it.
        </p>
      )}

      {/* 1 — safety: the only thing that stands between the student and the camera */}
      {safety.length > 0 && (
        <section
          className="card p-5"
          style={{ borderColor: "var(--clay)", borderWidth: 2, background: "var(--sunk)" }}
        >
          <p className="label" style={{ color: "var(--clay)" }}>
            Safety first
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-[16px] font-semibold">
            {safety.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-[16px]">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0"
              checked={safetyAck}
              onChange={(e) => setSafetyAck(e.target.checked)}
            />
            <span>I&rsquo;ll shoot this safely.</span>
          </label>
          <p className="mt-3 text-[15px]" style={{ color: "var(--clay)" }}>
            If a prompt can&rsquo;t be done safely, don&rsquo;t shoot it. Report it instead.
          </p>
          <SafetyReport ideaId={ideaId} />
        </section>
      )}

      {/* 2 — the rest of the rules, to read; the format checks catch mistakes */}
      {tips.length > 0 && (
        <section className="card p-5">
          <p className="label">For a usable shot</p>
          <ul className="mt-3 flex flex-col gap-2 text-[15px]">
            {tips.map((item) => (
              <li key={item.id} className="flex gap-3">
                <span aria-hidden style={{ color: "var(--accent)" }}>
                  —
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3 — the shot: choose, look at it, then send it up */}
      <section className="card p-5">
        <p className="label">The shot</p>

        {resumed && upload === "done" && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {resume!.media.map((m) =>
              m.kind === "video" ? (
                <video
                  key={m.id}
                  src={`${mediaUrl(resume!.captureId, m.id)}#t=0.1`}
                  controls
                  playsInline
                  muted
                  preload="metadata"
                  className="col-span-2 max-h-[50vh] w-full rounded-sm bg-black"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={m.id}
                  src={mediaUrl(resume!.captureId, m.id)}
                  alt="Your uploaded photo"
                  className="aspect-square w-full rounded-sm object-cover"
                />
              ),
            )}
          </div>
        )}

        {mediaType === "video" ? (
          <>
            {!file && !resumed && (
              <label
                className={`btn mt-3 block cursor-pointer text-center ${ready ? "" : "pointer-events-none opacity-40"}`}
              >
                Open camera
                <input
                  type="file"
                  className="sr-only"
                  accept="video/*"
                  capture="environment"
                  disabled={!ready}
                  onChange={onPick}
                />
              </label>
            )}
            {file && previewUrl && (
              <video
                src={previewUrl}
                controls
                playsInline
                className="mt-3 max-h-[50vh] w-full rounded-sm bg-black"
              />
            )}
          </>
        ) : (
          !resumed && (
            <PhotoCamera
              key={cameraKey}
              orientation={orientation}
              maxCount={maxMediaCount}
              disabled={!ready || shotLocked}
              onChange={setPhotoFiles}
            />
          )
        )}

        {!ready && (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Tick &ldquo;I&rsquo;ll shoot this safely&rdquo; to open the camera.
          </p>
        )}

        {file && (
          <div className="mt-3 flex flex-col gap-2 text-sm">
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

        {/* Review before upload */}
        {upload === "idle" && (file || photoFiles.length >= minMediaCount) && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn"
              type="button"
              disabled={Boolean(file) && blocking}
              onClick={() => void startUpload(file ? [file] : photoFiles)}
            >
              {file
                ? "Use this"
                : `Use ${photoFiles.length === 1 ? "this photo" : `these ${photoFiles.length} photos`}`}
            </button>
            {file && (
              <label className="btn btn-quiet cursor-pointer">
                Retake
                <input
                  type="file"
                  className="sr-only"
                  accept="video/*"
                  capture="environment"
                  onChange={onPick}
                />
              </label>
            )}
          </div>
        )}
        {upload === "idle" && file && blocking && (
          <p className="mt-2 text-sm" style={{ color: "var(--clay)" }}>
            This one can&rsquo;t be sent as it is. Retake it.
          </p>
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
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }} role="status">
              {upload === "uploading" &&
                `Uploading ${Math.round(progress * 100)}%. Keep this screen open.`}
              {upload === "done" && "Uploaded. Now tell us what it is."}
            </p>
            {upload === "failed" && (
              <>
                <p className="mt-2 text-sm" style={{ color: "var(--clay)" }} role="alert">
                  {uploadError}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void startUpload(lastFilesRef.current)}
                  >
                    Try again
                  </button>
                  {canReplace && (
                    <button className="btn btn-quiet" type="button" onClick={() => void replace()}>
                      Choose a different shot
                    </button>
                  )}
                </div>
              </>
            )}
            {upload === "done" && canReplace && (
              <button
                className="btn btn-quiet mt-3"
                type="button"
                onClick={() => void replace()}
              >
                Retake
              </button>
            )}
          </div>
        )}
      </section>

      {/* 4 — the context marketing needs, and nothing more */}
      <section className="card p-5">
        {captionRequired && (
          <>
            <label className="label" htmlFor="one-liner">What is happening? One line.</label>
            <input
              id="one-liner"
              value={oneLiner}
              onChange={(e) => setOneLiner(e.target.value)}
              maxLength={140}
              className="card mt-2 w-full px-3 py-3"
              style={{ background: "var(--bg)" }}
              placeholder="Last five minutes before the bus leaves"
            />
          </>
        )}

        <p className={`label ${captionRequired ? "mt-5" : ""}`}>Who is in it?</p>
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
      </section>

      <div className="flex flex-col gap-2">
        <button className="btn" disabled={!canSubmit} onClick={submit} type="button">
          {submitting ? "Sending…" : "Send it"}
        </button>
        {blockers.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm" style={{ color: "var(--muted)" }} aria-live="polite">
            {blockers.map((reason) => (
              <li key={reason}>To send: {reason}</li>
            ))}
          </ul>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--clay)" }} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
