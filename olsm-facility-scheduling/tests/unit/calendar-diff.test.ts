import { describe, expect, it } from "vitest";
import {
  eventMatchesExpected,
  type CalendarEvent,
  type CalendarEventInput,
} from "@/integrations/calendar/google-calendar";
import { verifyWebhookSignature } from "@/integrations/payments/stripe";
import { createHmac } from "node:crypto";

const expected: CalendarEventInput = {
  summary: "Boys Basketball practice — Full court",
  description: "…",
  location: "Rakoczy Gymnasium, Full court",
  startAt: new Date("2026-11-10T20:30:00Z"),
  endAt: new Date("2026-11-10T22:30:00Z"),
  bookingId: "b1",
  bookingReference: "OLSM-1",
  syncVersion: 3,
};

function googleEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt1",
    summary: expected.summary,
    location: expected.location,
    start: { dateTime: expected.startAt.toISOString() },
    end: { dateTime: expected.endAt.toISOString() },
    status: "confirmed",
    extendedProperties: { private: { olsmBookingId: "b1", olsmSyncVersion: "3" } },
    ...overrides,
  };
}

/**
 * Acceptance criterion 9: an edit made directly in Google Calendar is detected
 * so it can be reverted. This is the detection half; the write-back is
 * exercised against the live API.
 */
describe("detecting edits made in Google Calendar", () => {
  it("treats an untouched event as matching", () => {
    expect(eventMatchesExpected(googleEvent(), expected).matches).toBe(true);
  });

  it("detects a moved start time", () => {
    const result = eventMatchesExpected(
      googleEvent({ start: { dateTime: "2026-11-10T21:00:00Z" } }),
      expected,
    );
    expect(result.matches).toBe(false);
    expect(result.differences).toContain("start time");
  });

  it("detects a renamed event", () => {
    const result = eventMatchesExpected(googleEvent({ summary: "Something else" }), expected);
    expect(result.differences).toContain("title");
  });

  it("detects a moved location", () => {
    const result = eventMatchesExpected(googleEvent({ location: "Dombrowski, Court A" }), expected);
    expect(result.differences).toContain("location");
  });

  it("detects a deletion", () => {
    const result = eventMatchesExpected(googleEvent({ status: "cancelled" }), expected);
    expect(result.differences).toContain("deletion");
  });

  it("reports every field that changed at once", () => {
    const result = eventMatchesExpected(
      googleEvent({ summary: "Moved", start: { dateTime: "2026-11-10T23:00:00Z" } }),
      expected,
    );
    expect(result.differences).toEqual(expect.arrayContaining(["title", "start time"]));
  });
});

describe("stripe webhook signature", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });

  function sign(timestamp: number, body = payload, key = secret): string {
    const v1 = createHmac("sha256", key).update(`${timestamp}.${body}`, "utf8").digest("hex");
    return `t=${timestamp},v1=${v1}`;
  }

  it("accepts a correctly signed recent payload", () => {
    const now = Date.now();
    const event = verifyWebhookSignature(payload, sign(Math.floor(now / 1000)), secret, 300, now);
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects a tampered payload", () => {
    const now = Date.now();
    const header = sign(Math.floor(now / 1000));
    expect(() =>
      verifyWebhookSignature(payload.replace("evt_1", "evt_2"), header, secret, 300, now),
    ).toThrow(/signature mismatch/i);
  });

  it("rejects a replayed payload outside the tolerance", () => {
    const now = Date.now();
    const old = Math.floor(now / 1000) - 3600;
    expect(() => verifyWebhookSignature(payload, sign(old), secret, 300, now)).toThrow(
      /outside tolerance/i,
    );
  });

  it("rejects a signature made with the wrong secret", () => {
    const now = Date.now();
    const header = sign(Math.floor(now / 1000), payload, "whsec_wrong");
    expect(() => verifyWebhookSignature(payload, header, secret, 300, now)).toThrow(
      /signature mismatch/i,
    );
  });
});
