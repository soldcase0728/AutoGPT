import { describe, expect, it } from "vitest";
import {
  ImageSafetyResultSchema,
  SafetyProviderError,
  parseStrictJson,
} from "@/lib/safety/schemas";

describe("strict safety provider output", () => {
  it("accepts an explicit clean image result", () => {
    expect(parseStrictJson('{"findings":[]}', ImageSafetyResultSchema)).toEqual({ findings: [] });
  });

  it("retains an explicit profanity finding", () => {
    const parsed = parseStrictJson(JSON.stringify({ findings: [{
      category: "profanity_text", severity: "high", confidence: 0.98,
      description: "Profanity is visible on a sign.", bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
    }] }), ImageSafetyResultSchema);
    expect(parsed.findings[0]?.category).toBe("profanity_text");
  });

  it.each([
    ["malformed JSON", "not json"],
    ["missing fields", '{"findings":[{"category":"profanity_text"}]}'],
    ["unknown category", '{"findings":[{"category":"other","severity":"high","confidence":1,"description":"x","bounding_box":null}]}'],
    ["invalid confidence", '{"findings":[{"category":"profanity_text","severity":"high","confidence":2,"description":"x","bounding_box":null}]}'],
    ["unknown biometric field", '{"findings":[{"category":"identifiable_person","severity":"low","confidence":0.9,"description":"x","bounding_box":null,"identity":"Student A"}]}'],
  ])("rejects %s rather than treating it as clean", (_name, output) => {
    expect(() => parseStrictJson(output, ImageSafetyResultSchema)).toThrow(SafetyProviderError);
  });
});
