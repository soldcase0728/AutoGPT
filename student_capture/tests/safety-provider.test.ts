import { describe, expect, it } from "vitest";
import { OpenAIMediaSafetyProvider } from "@/lib/safety/openai-provider";
import { SafetyProviderError } from "@/lib/safety/schemas";

describe("safety provider configuration", () => {
  it("fails terminally when the provider is not configured", () => {
    try {
      new OpenAIMediaSafetyProvider({ apiKey: "" });
      throw new Error("provider should not have been created");
    } catch (error) {
      expect(error).toBeInstanceOf(SafetyProviderError);
      expect((error as SafetyProviderError).code).toBe("provider_not_configured");
      expect((error as SafetyProviderError).retryable).toBe(false);
    }
  });
});
