import { describe, expect, it } from "vitest";
import { describeBlocker, publishable, signatureMatches } from "@/lib/consent";

describe("publishable", () => {
  it("is true only when the gate returned nothing", () => {
    expect(publishable([])).toBe(true);
    expect(publishable(null)).toBe(true);
    expect(publishable([{ reason: "age_unknown" }])).toBe(false);
  });
});

describe("describeBlocker", () => {
  it("names the person and what they have to do", () => {
    expect(describeBlocker({ person: "Jo Mercer", reason: "parental_missing" })).toBe(
      "Jo Mercer — Under 18 — no parental release on file.",
    );
  });

  it("prefers the detail the database supplied", () => {
    expect(
      describeBlocker({ reason: "no_people_declared", detail: "Tag everyone in frame." }),
    ).toBe("Tag everyone in frame.");
  });

  it("degrades legibly on a reason it has never seen", () => {
    expect(describeBlocker({ reason: "future_rule" })).toBe("Unresolved: future_rule");
  });
});

describe("signatureMatches", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(signatureMatches("  ali   HADDAD ", "Ali Haddad")).toBe(true);
    expect(signatureMatches("C Castiglione", "C. Castiglione")).toBe(true);
    expect(signatureMatches("Zoe", "Zoë")).toBe(true);
  });

  it("still needs the actual name", () => {
    expect(signatureMatches("Ali", "Ali Haddad")).toBe(false);
    expect(signatureMatches("", "Ali Haddad")).toBe(false);
    expect(signatureMatches("x", "")).toBe(false);
  });
});
