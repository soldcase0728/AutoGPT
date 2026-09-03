import type { TranscriptSegment } from "./schemas";
import type { SafetyCategory } from "./categories";

export interface SafetyFindingResult {
  category: SafetyCategory;
  severity: "low" | "medium" | "high";
  confidence: number;
  description: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  startMs?: number;
  endMs?: number;
  detector: string;
}
export interface TranscriptionResult {
  segments: TranscriptSegment[];
  usage?: Record<string, unknown>;
}

export interface MediaSafetyProvider {
  readonly name: string;
  readonly visionModel: string;
  readonly transcriptionModel: string;
  analyzeImage(input: { bytes: Uint8Array; mimeType: string }): Promise<{
    findings: SafetyFindingResult[];
    usage?: Record<string, unknown>;
  }>;
  transcribeAudio(input: { bytes: Uint8Array; filename: string; mimeType: string }): Promise<TranscriptionResult>;
  analyzeTranscript(input: { segments: TranscriptSegment[] }): Promise<{
    findings: SafetyFindingResult[];
    usage?: Record<string, unknown>;
  }>;
}
