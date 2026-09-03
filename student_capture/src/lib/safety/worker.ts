import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { OpenAIMediaSafetyProvider } from "./openai-provider";
import type { MediaSafetyProvider, SafetyFindingResult } from "./provider";
import { extractVideo } from "./extractor";
import { SafetyProviderError } from "./schemas";

const MAX_ATTEMPTS = 3;
const TEMP_BUCKET = "safety-temp";

interface SafetyJob {
  id: string;
  safety_screen_id: string;
  submission_media_id: string | null;
  kind: "analyze_image" | "extract_video" | "analyze_video_frame" | "transcribe_audio" | "analyze_transcript" | "finalize_screen" | "cleanup";
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string;
}

interface MediaRow {
  id: string;
  submission_id: string;
  media_revision: number;
  bucket: string;
  storage_key: string;
  mime_type: string | null;
}

async function ensureEligible(admin: SupabaseClient, job: SafetyJob): Promise<MediaRow> {
  if (!job.submission_media_id) throw new SafetyProviderError("media_unavailable", "Safety job has no media.", false);
  const { data: media } = await admin.from("submission_media")
    .select("id, submission_id, media_revision, bucket, storage_key, mime_type")
    .eq("id", job.submission_media_id).single();
  if (!media) throw new SafetyProviderError("media_unavailable", "Submission media is unavailable.", false);
  const { data: capture } = await admin.from("captures")
    .select("state, takedown_at, media_revision").eq("id", media.submission_id).single();
  if (!capture || ["withdrawal_requested", "withdrawn"].includes(capture.state)
      || capture.takedown_at || capture.media_revision !== media.media_revision) {
    throw new SafetyProviderError("media_unavailable", "Submission media is no longer eligible for scanning.", false);
  }
  return media as MediaRow;
}

async function download(admin: SupabaseClient, bucket: string, key: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(bucket).download(key);
  if (error || !data) throw new SafetyProviderError("media_download_failed", "Private media could not be downloaded.", true);
  return new Uint8Array(await data.arrayBuffer());
}

async function saveFindings(admin: SupabaseClient, job: SafetyJob, findings: SafetyFindingResult[]) {
  if (!job.submission_media_id) return;
  const { error } = await admin.rpc("record_safety_job_findings", {
    p_job_id: job.id, p_lease_token: job.lease_token,
    p_findings: findings.map((finding) => ({
      category: finding.category, severity: finding.severity, confidence: finding.confidence,
      description: finding.description, start_ms: finding.startMs ?? null,
      end_ms: finding.endMs ?? null, bounding_box: finding.boundingBox ?? null,
      detector: finding.detector,
    })),
  });
  if (error) throw new SafetyProviderError(error.code === "40001" ? "lease_lost" : "finding_write_failed",
    error.code === "40001" ? "Safety job lease was lost." : "Safety findings could not be recorded.", true);
}

async function saveUsage(admin: SupabaseClient, job: SafetyJob, usage?: Record<string, unknown>) {
  if (!usage || Object.keys(usage).length === 0) return;
  const { error } = await admin.rpc("record_safety_job_usage", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_usage: usage,
  });
  if (error) throw new SafetyProviderError(error.code === "40001" ? "lease_lost" : "usage_write_failed",
    error.code === "40001" ? "Safety job lease was lost." : "Safety provider usage could not be recorded.", true);
}

async function finalizeIfReady(admin: SupabaseClient, screenId: string) {
  const { data: screen } = await admin.from("safety_screens").select("status, started_at")
    .eq("id", screenId).single();
  if (!screen || ["cancelled", "superseded", "no_flags", "flags_detected", "screening_failed"].includes(screen.status)) return;
  const { data: jobs } = await admin.from("safety_jobs").select("status, kind, last_error_code")
    .eq("safety_screen_id", screenId).neq("kind", "cleanup");
  if (!jobs?.length || jobs.some((item) => ["pending", "processing"].includes(item.status))) return;
  const failed = jobs.find((item) => item.status === "failed");
  const cancelled = jobs.find((item) => item.status === "cancelled");
  if (cancelled && !failed) {
    await admin.from("safety_screens").update({ status: "cancelled", cancelled_at: new Date().toISOString(),
      completed_at: new Date().toISOString(), error_code: "media_unavailable" }).eq("id", screenId);
    return;
  }
  const { data: findings, count } = await admin.from("safety_findings")
    .select("severity", { count: "exact" }).eq("safety_screen_id", screenId);
  const risk = findings?.some((item) => item.severity === "high") ? "high"
    : findings?.some((item) => item.severity === "medium") ? "medium"
      : findings?.length ? "low" : null;
  const now = new Date();
  await admin.from("safety_screens").update({
    status: failed ? "screening_failed" : (count ?? 0) > 0 ? "flags_detected" : "no_flags",
    overall_risk_level: failed ? null : risk,
    completed_at: now.toISOString(),
    processing_time_ms: screen.started_at ? now.getTime() - new Date(screen.started_at).getTime() : null,
    error_code: failed?.last_error_code ?? null,
  }).eq("id", screenId).in("status", ["pending", "processing"]);
}

async function completeJob(admin: SupabaseClient, job: SafetyJob) {
  const { data, error } = await admin.from("safety_jobs").update({ status: "completed",
    completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null,
    heartbeat_at: new Date().toISOString() })
    .eq("id", job.id).eq("lease_token", job.lease_token).eq("status", "processing")
    .select("id").maybeSingle();
  if (error || !data) throw new SafetyProviderError("lease_lost", "Safety job lease was lost.", true);
  await finalizeIfReady(admin, job.safety_screen_id);
}

async function failJob(admin: SupabaseClient, job: SafetyJob, error: unknown) {
  const known = error instanceof SafetyProviderError
    ? error : new SafetyProviderError("worker_error", "Safety worker failed.", true);
  const retry = known.retryable && job.attempt_count < MAX_ATTEMPTS;
  const delaySeconds = Math.min(300, 5 * 2 ** Math.max(0, job.attempt_count - 1));
  await admin.from("safety_jobs").update(retry ? {
    status: "pending", available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    lease_token: null, lease_expires_at: null, last_error_code: known.code, last_error_safe: known.message,
  } : {
    status: known.code === "media_unavailable" ? "cancelled" : "failed",
    completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null,
    last_error_code: known.code, last_error_safe: known.message,
  }).eq("id", job.id).eq("lease_token", job.lease_token);
  if (!retry) await finalizeIfReady(admin, job.safety_screen_id);
}

async function createVideoChildren(admin: SupabaseClient, job: SafetyJob, media: MediaRow,
  extracted: Awaited<ReturnType<typeof extractVideo>>) {
  const prefix = `${job.safety_screen_id}/${media.id}`;
  const childRows: Array<Record<string, unknown>> = [];
  for (const [index, frame] of extracted.frames.entries()) {
    const key = `${prefix}/frame-${String(index).padStart(6, "0")}.jpg`;
    const { error } = await admin.storage.from(TEMP_BUCKET).upload(key, frame.bytes,
      { contentType: "image/jpeg", upsert: true });
    if (error) throw new SafetyProviderError("temporary_upload_failed", "A derived frame could not be stored.", true);
    childRows.push({ safety_screen_id: job.safety_screen_id, submission_media_id: media.id,
      kind: "analyze_video_frame", dedupe_key: `${job.safety_screen_id}:${media.id}:frame:${frame.timestampMs}`,
      payload: { bucket: TEMP_BUCKET, key, timestamp_ms: frame.timestampMs } });
  }
  if (extracted.audio) {
    const key = `${prefix}/audio.mp3`;
    const { error } = await admin.storage.from(TEMP_BUCKET).upload(key, extracted.audio,
      { contentType: "audio/mpeg", upsert: true });
    if (error) throw new SafetyProviderError("temporary_upload_failed", "Derived audio could not be stored.", true);
    childRows.push({ safety_screen_id: job.safety_screen_id, submission_media_id: media.id,
      kind: "transcribe_audio", dedupe_key: `${job.safety_screen_id}:${media.id}:audio`,
      payload: { bucket: TEMP_BUCKET, key } });
  }
  childRows.push({ safety_screen_id: job.safety_screen_id, submission_media_id: media.id,
    kind: "cleanup", dedupe_key: `${job.safety_screen_id}:${media.id}:cleanup`,
    available_at: new Date(Date.now() + 10 * 60_000).toISOString(), payload: { prefix } });
  const { error } = await admin.from("safety_jobs").upsert(childRows,
    { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw new SafetyProviderError("job_write_failed", "Video analysis jobs could not be created.", true);
  await admin.from("safety_screens").update({ sampled_frame_count: extracted.frames.length,
    media_duration_ms: extracted.durationMs }).eq("id", job.safety_screen_id);
}

async function processClaimedJob(admin: SupabaseClient, provider: MediaSafetyProvider, job: SafetyJob) {
  if (job.kind === "cleanup") {
    const { data: active } = await admin.from("safety_jobs").select("id")
      .eq("safety_screen_id", job.safety_screen_id).neq("kind", "cleanup")
      .in("status", ["pending", "processing"]).limit(1);
    if (active?.length) throw new SafetyProviderError("analysis_incomplete", "Video analysis is not complete.", true);
    const prefix = String(job.payload.prefix ?? "");
    const { data: objects } = await admin.storage.from(TEMP_BUCKET).list(prefix, { limit: 1000 });
    if (objects?.length) await admin.storage.from(TEMP_BUCKET).remove(objects.map((item) => `${prefix}/${item.name}`));
    await completeJob(admin, job);
    return;
  }
  const media = await ensureEligible(admin, job);
  if (job.kind === "analyze_image") {
    const result = await provider.analyzeImage({ bytes: await download(admin, media.bucket, media.storage_key),
      mimeType: media.mime_type ?? "image/jpeg" });
    await saveFindings(admin, job, result.findings);
    await saveUsage(admin, job, result.usage);
  } else if (job.kind === "extract_video") {
    await createVideoChildren(admin, job, media, await extractVideo(await download(admin, media.bucket, media.storage_key)));
  } else if (job.kind === "analyze_video_frame") {
    const result = await provider.analyzeImage({ bytes: await download(admin, String(job.payload.bucket), String(job.payload.key)),
      mimeType: "image/jpeg" });
    const timestamp = Number(job.payload.timestamp_ms);
    await saveFindings(admin, job, result.findings.map((finding) => ({ ...finding, startMs: timestamp, endMs: timestamp })));
    await saveUsage(admin, job, result.usage);
  } else if (job.kind === "transcribe_audio") {
    const transcript = await provider.transcribeAudio({
      bytes: await download(admin, String(job.payload.bucket), String(job.payload.key)),
      filename: "audio.mp3", mimeType: "audio/mpeg" });
    const analysis = await provider.analyzeTranscript({ segments: transcript.segments });
    await saveFindings(admin, job, analysis.findings);
    await saveUsage(admin, job, {
      ...(transcript.usage ?? {}),
      ...(analysis.usage ?? {}),
    });
  }
  await admin.from("safety_screens").update({ provider: provider.name, model: provider.visionModel,
    prompt_version: "2026-09-03" }).eq("id", job.safety_screen_id);
  await completeJob(admin, job);
}

export async function processNextSafetyJob(options?: { provider?: MediaSafetyProvider }) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_safety_job", { p_lease_seconds: 240 });
  if (error) throw new Error(`Could not claim safety job: ${error.message}`);
  const job = data as SafetyJob | null;
  if (!job?.id) return { processed: false as const };
  const heartbeat = setInterval(() => {
    void admin.rpc("heartbeat_safety_job", {
      p_job_id: job.id, p_lease_token: job.lease_token, p_lease_seconds: 240,
    });
  }, 30_000);
  try {
    await processClaimedJob(admin, options?.provider ?? new OpenAIMediaSafetyProvider(), job);
  } catch (jobError) {
    await failJob(admin, job, jobError);
  } finally {
    clearInterval(heartbeat);
  }
  return { processed: true as const, jobId: job.id };
}
