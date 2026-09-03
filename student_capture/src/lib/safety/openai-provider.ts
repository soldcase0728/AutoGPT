import "server-only";
import OpenAI, { toFile } from "openai";
import {
  IMAGE_RESULT_JSON_SCHEMA,
  ImageSafetyResultSchema,
  SafetyProviderError,
  TRANSCRIPT_RESULT_JSON_SCHEMA,
  TranscriptSafetyResultSchema,
  parseStrictJson,
  type TranscriptSegment,
} from "./schemas";
import type { MediaSafetyProvider, SafetyFindingResult } from "./provider";

const IMAGE_INSTRUCTIONS = `You are an advisory safety screener for school-owned media.
Inspect the full-resolution image carefully, including small visible text. Report every likely concern using only the supplied categories. Look for profanity; obscene, threatening, harassing or discriminatory language; IDs, names, schedules, email addresses, phone numbers, addresses, birth dates, medical/private paperwork, license plates and sensitive screens; nudity, violence, weapons, drugs, alcohol, vaping, obscene gestures, inappropriate activity; and identifiable people.
Face/person detection is allowed. Never identify a person, infer identity, or perform biometric matching.
Bounding boxes use normalized x,y,width,height coordinates and must refer only to this image. Return an empty findings array only after examining all categories.`;

const TRANSCRIPT_INSTRUCTIONS = `Review timestamped school-video transcript segments for spoken profanity, obscene or sexual language, threats, harassment, bullying, slurs, names, email addresses, phone numbers, addresses, birth dates, medical/private discussion, drugs, alcohol or other sensitive speech. Use only the supplied categories. Reference the exact segment_index provided; do not invent timestamps.`;

function providerFailure(error: unknown): never {
  if (error instanceof SafetyProviderError) throw error;
  if (error instanceof OpenAI.APIError) {
    const retryable = error.status === 408 || error.status === 409 || error.status === 429 || (error.status ?? 0) >= 500;
    throw new SafetyProviderError("provider_http_error", `Safety provider request failed (${error.status ?? "unknown"}).`, retryable);
  }
  throw new SafetyProviderError("provider_unavailable", "Safety provider request failed.", true);
}

export class OpenAIMediaSafetyProvider implements MediaSafetyProvider {
  readonly name = "openai";
  readonly visionModel: string;
  readonly transcriptionModel: string;
  private readonly client: OpenAI;

  constructor(options?: { apiKey?: string; visionModel?: string; transcriptionModel?: string }) {
    const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new SafetyProviderError("provider_not_configured", "OPENAI_API_KEY is not configured.", false);
    this.visionModel = options?.visionModel ?? process.env.SAFETY_VISION_MODEL ?? "gpt-5-mini";
    this.transcriptionModel = options?.transcriptionModel ?? process.env.SAFETY_TRANSCRIPTION_MODEL ?? "whisper-1";
    this.client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
  }

  async analyzeImage(input: { bytes: Uint8Array; mimeType: string }) {
    try {
      const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
      const [response, moderation] = await Promise.all([this.client.responses.create({
        model: this.visionModel,
        store: false,
        instructions: IMAGE_INSTRUCTIONS,
        input: [{ role: "user", content: [{ type: "input_image", image_url: dataUrl, detail: "high" }] }],
        text: { format: { type: "json_schema", name: "school_media_safety", strict: true, schema: IMAGE_RESULT_JSON_SCHEMA } },
      }), this.client.moderations.create({
        model: process.env.SAFETY_MODERATION_MODEL ?? "omni-moderation-latest",
        input: [{ type: "image_url", image_url: { url: dataUrl } }],
      })]);
      const parsed = parseStrictJson(response.output_text, ImageSafetyResultSchema);
      const moderationResult = moderation.results[0];
      const categories = (moderationResult?.categories ?? {}) as unknown as Record<string, boolean>;
      const scores = (moderationResult?.category_scores ?? {}) as unknown as Record<string, number>;
      const moderated: SafetyFindingResult[] = [];
      const addModerated = (category: SafetyFindingResult["category"], keys: string[], description: string) => {
        const hit = keys.find((key) => categories[key]);
        if (hit) moderated.push({ category, severity: "high", confidence: scores[hit] ?? 1,
          description, detector: `openai:${moderation.model}:moderation` });
      };
      addModerated("nudity_or_sexual_content", ["sexual", "sexual/minors"], "Potential sexual or nude content detected.");
      addModerated("violence", ["violence", "violence/graphic"], "Potential violent content detected.");
      addModerated("threatening_language", ["harassment/threatening", "hate/threatening"], "Potential threatening content detected.");
      return {
        findings: [...parsed.findings.map((finding): SafetyFindingResult => ({
          category: finding.category,
          severity: finding.severity,
          confidence: finding.confidence,
          description: finding.description,
          boundingBox: finding.bounding_box ?? undefined,
          detector: `openai:${this.visionModel}:vision`,
        })), ...moderated],
        usage: {
          input_tokens: response.usage?.input_tokens ?? 0,
          output_tokens: response.usage?.output_tokens ?? 0,
          moderation_requests: 1,
        },
      };
    } catch (error) {
      return providerFailure(error);
    }
  }

  async transcribeAudio(input: { bytes: Uint8Array; filename: string; mimeType: string }) {
    try {
      const file = await toFile(Buffer.from(input.bytes), input.filename, { type: input.mimeType });
      const response = await this.client.audio.transcriptions.create({
        file,
        model: this.transcriptionModel,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      });
      const rawSegments = "segments" in response && Array.isArray(response.segments) ? response.segments : [];
      const segments: TranscriptSegment[] = rawSegments.map((segment, index) => ({
        index,
        startMs: Math.max(0, Math.round(Number(segment.start) * 1000)),
        endMs: Math.max(0, Math.round(Number(segment.end) * 1000)),
        text: String(segment.text ?? "").trim(),
      })).filter((segment) => segment.text.length > 0);
      if (segments.length === 0 && response.text.trim()) {
        segments.push({ index: 0, startMs: 0, endMs: 0, text: response.text.trim() });
      }
      return {
        segments,
        usage: {
          transcription_seconds: segments.reduce((maximum, segment) => Math.max(maximum, segment.endMs), 0) / 1000,
        },
      };
    } catch (error) {
      return providerFailure(error);
    }
  }

  async analyzeTranscript(input: { segments: TranscriptSegment[] }) {
    if (input.segments.length === 0) return { findings: [] };
    try {
      const transcript = input.segments.map((segment) => ({
        segment_index: segment.index,
        start_ms: segment.startMs,
        end_ms: segment.endMs,
        text: segment.text,
      }));
      const response = await this.client.responses.create({
        model: this.visionModel,
        store: false,
        instructions: TRANSCRIPT_INSTRUCTIONS,
        input: JSON.stringify(transcript),
        text: { format: { type: "json_schema", name: "school_audio_safety", strict: true, schema: TRANSCRIPT_RESULT_JSON_SCHEMA } },
      });
      const parsed = parseStrictJson(response.output_text, TranscriptSafetyResultSchema);
      return {
        findings: parsed.findings.map((finding): SafetyFindingResult => {
          const segment = input.segments[finding.segment_index];
          if (!segment) throw new SafetyProviderError("provider_invalid_response", "Provider referenced an unknown transcript segment.", false);
          return {
            category: finding.category,
            severity: finding.severity,
            confidence: finding.confidence,
            description: finding.description,
            startMs: segment.startMs,
            endMs: segment.endMs,
            detector: `openai:${this.visionModel}:transcript`,
          };
        }),
        usage: response.usage ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } : undefined,
      };
    } catch (error) {
      return providerFailure(error);
    }
  }
}
