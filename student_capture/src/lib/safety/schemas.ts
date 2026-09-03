import { z } from "zod";
import { SAFETY_CATEGORIES } from "./categories";

export const BoundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().refine((box) => box.x + box.width <= 1.001 && box.y + box.height <= 1.001,
  "Bounding box must fit inside the image");

export const ProviderFindingSchema = z.object({
  category: z.enum(SAFETY_CATEGORIES),
  severity: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  description: z.string().trim().min(1).max(500),
  bounding_box: BoundingBoxSchema.nullable(),
}).strict();

export const ImageSafetyResultSchema = z.object({
  findings: z.array(ProviderFindingSchema).max(100),
}).strict();

export const TranscriptFindingSchema = z.object({
  category: z.enum(SAFETY_CATEGORIES),
  severity: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  description: z.string().trim().min(1).max(500),
  segment_index: z.number().int().nonnegative(),
}).strict();

export const TranscriptSafetyResultSchema = z.object({
  findings: z.array(TranscriptFindingSchema).max(100),
}).strict();

export interface TranscriptSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}
export type ProviderFinding = z.infer<typeof ProviderFindingSchema>;

const findingProperties = {
  category: { type: "string", enum: [...SAFETY_CATEGORIES] },
  severity: { type: "string", enum: ["low", "medium", "high"] },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  description: { type: "string", minLength: 1, maxLength: 500 },
};

export const IMAGE_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "confidence", "description", "bounding_box"],
        properties: {
          ...findingProperties,
          bounding_box: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "width", "height"],
                properties: {
                  x: { type: "number", minimum: 0, maximum: 1 },
                  y: { type: "number", minimum: 0, maximum: 1 },
                  width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                  height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;

export const TRANSCRIPT_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "confidence", "description", "segment_index"],
        properties: {
          ...findingProperties,
          segment_index: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

export function parseStrictJson<T>(text: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SafetyProviderError("provider_invalid_response", "Provider returned malformed JSON.", false);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SafetyProviderError("provider_invalid_response", "Provider response failed strict validation.", false);
  }
  return parsed.data;
}

export class SafetyProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SafetyProviderError";
  }
}
