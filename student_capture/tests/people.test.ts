import { describe, expect, it } from "vitest";
import {
  needsParentalRelease,
  releaseStatus,
  temporaryPassword,
  type ConsentRecord,
} from "@/lib/people";

const now = new Date("2026-09-24T12:00:00Z");
const base: ConsentRecord = {
  type: "media_release",
  document_version: "release-2026-01",
  signed_at: "2026-09-01T10:00:00Z",
  signed_by: "Ali Haddad",
  expires_at: null,
  revoked_at: null,
};

describe("releaseStatus", () => {
  it("is missing with no records", () => {
    expect(releaseStatus([], "parental", { now })).toBe("missing");
  });

  it("is valid for a live record", () => {
    expect(releaseStatus([base], "media_release", { now })).toBe("valid");
  });

  it("prefers a live record over a newer revoked one, like the gate", () => {
    const revoked = { ...base, signed_at: "2026-09-10T10:00:00Z", revoked_at: "2026-09-11T10:00:00Z" };
    expect(releaseStatus([base, revoked], "media_release", { now })).toBe("valid");
    expect(releaseStatus([revoked], "media_release", { now })).toBe("revoked");
  });

  it("reports expiry", () => {
    expect(releaseStatus([{ ...base, expires_at: "2026-09-01T00:00:00Z" }], "media_release", { now })).toBe("expired");
  });

  it("flags a release signed on older wording", () => {
    expect(
      releaseStatus([{ ...base, document_version: "release-2025-01" }], "media_release", {
        now,
        requiredVersion: "release-2026-01",
      }),
    ).toBe("outdated");
  });
});

describe("needsParentalRelease", () => {
  it("covers minors and unknown ages", () => {
    expect(needsParentalRelease(2011, now)).toBe(true);
    expect(needsParentalRelease(null, now)).toBe(true);
    expect(needsParentalRelease(2004, now)).toBe(false);
  });
});

describe("temporaryPassword", () => {
  it("is 12 readable characters in three groups", () => {
    const password = temporaryPassword();
    expect(password).toMatch(/^[^\W_0O1lI5S28Bio]{4}-[^\W_0O1lI5S28Bio]{4}-[^\W_0O1lI5S28Bio]{4}$/);
  });

  it("differs between calls", () => {
    expect(temporaryPassword()).not.toBe(temporaryPassword());
  });
});
