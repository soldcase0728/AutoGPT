/**
 * Google Calendar, one-way: the app is the source of truth.
 *
 * The app writes, updates and deletes events. Edits made directly in Google
 * Calendar are detected through push notifications and reverted, with a note to
 * whoever made the edit. Two-way sync on a system with approval and payment
 * gates produces conflict states nobody can resolve -- a coach dragging a
 * confirmed, paid rental to a different court in Google has no way to re-run
 * the conflict check, the contract or the invoice.
 *
 * Rate limits are handled by the caller: every write goes through the job queue
 * (src/services/calendar-sync-service.ts), which retries with exponential
 * backoff and alerts an admin when a job exhausts its attempts.
 */

import { getCalendarAccessToken, serviceAccountConfigured } from "@/lib/auth/google";

const API_BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarEventInput {
  summary: string;
  description: string;
  location?: string;
  startAt: Date;
  endAt: Date;
  /** Written into extendedProperties so a webhook can map an event back. */
  bookingId: string;
  bookingReference: string;
  syncVersion: number;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export class CalendarNotConfiguredError extends Error {
  constructor() {
    super("Google Calendar is not configured; skipping sync.");
    this.name = "CalendarNotConfiguredError";
  }
}

export function calendarConfigured(): boolean {
  return serviceAccountConfigured();
}

function eventBody(input: CalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startAt.toISOString() },
    end: { dateTime: input.endAt.toISOString() },
    extendedProperties: {
      private: {
        olsmBookingId: input.bookingId,
        olsmReference: input.bookingReference,
        olsmSyncVersion: String(input.syncVersion),
        olsmManaged: "true",
      },
    },
    // Guests cannot edit; the revert loop is the backstop, not the only guard.
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    source: { title: "OLSM Facility Scheduling", url: "" },
  };
}

async function call<T>(path: string, init: RequestInit & { retryOn429?: boolean } = {}): Promise<T> {
  if (!calendarConfigured()) throw new CalendarNotConfiguredError();

  const token = await getCalendarAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 404) {
    throw new CalendarApiError("Calendar resource not found.", 404, await res.text());
  }
  if (!res.ok) {
    const text = await res.text();
    throw new CalendarApiError(
      `Google Calendar API ${res.status}: ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class CalendarApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "CalendarApiError";
    this.status = status;
    this.body = body;
  }

  /** 403 rate-limit and 5xx are worth retrying; 400/404 are not. */
  get retryable(): boolean {
    if (this.status === 429) return true;
    if (this.status >= 500) return true;
    if (this.status === 403) return /rateLimitExceeded|userRateLimitExceeded|backendError/i.test(this.body);
    return false;
  }
}

export async function createEvent(
  calendarId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  return call<CalendarEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(eventBody(input)),
  });
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  return call<CalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PUT", body: JSON.stringify(eventBody(input)) },
  );
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await call<void>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  } catch (e) {
    // Already gone is the desired end state.
    if (e instanceof CalendarApiError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

export async function getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null> {
  try {
    return await call<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  } catch (e) {
    if (e instanceof CalendarApiError && e.status === 404) return null;
    throw e;
  }
}

/** Events changed since the last sync token; used by the revert watcher. */
export async function listChangedEvents(
  calendarId: string,
  syncToken?: string,
): Promise<{ events: CalendarEvent[]; nextSyncToken?: string; expiredToken: boolean }> {
  const params = new URLSearchParams({ showDeleted: "true", maxResults: "250" });
  if (syncToken) params.set("syncToken", syncToken);
  else params.set("timeMin", new Date(Date.now() - 86_400_000).toISOString());

  try {
    const body = await call<{ items?: CalendarEvent[]; nextSyncToken?: string }>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    return { events: body.items ?? [], nextSyncToken: body.nextSyncToken, expiredToken: false };
  } catch (e) {
    // 410 GONE means the sync token aged out; the caller re-syncs from scratch.
    if (e instanceof CalendarApiError && e.status === 410) {
      return { events: [], expiredToken: true };
    }
    throw e;
  }
}

export interface WatchChannel {
  id: string;
  resourceId: string;
  expiration?: string;
}

/** Subscribe to push notifications for a facility calendar. */
export async function watchCalendar(
  calendarId: string,
  channelId: string,
  webhookUrl: string,
  token: string,
): Promise<WatchChannel> {
  const body = await call<{ id: string; resourceId: string; expiration?: string }>(
    `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token,
      }),
    },
  );
  return { id: body.id, resourceId: body.resourceId, expiration: body.expiration };
}

export async function stopChannel(channelId: string, resourceId: string): Promise<void> {
  await call<void>("/channels/stop", {
    method: "POST",
    body: JSON.stringify({ id: channelId, resourceId }),
  });
}

/**
 * Whether a Google-side event still matches what we last wrote. Used to decide
 * whether a change notification is an echo of our own write or a human edit.
 */
export function eventMatchesExpected(
  event: CalendarEvent,
  expected: CalendarEventInput,
): { matches: boolean; differences: string[] } {
  const differences: string[] = [];

  if ((event.summary ?? "") !== expected.summary) differences.push("title");
  if (event.start?.dateTime && new Date(event.start.dateTime).getTime() !== expected.startAt.getTime()) {
    differences.push("start time");
  }
  if (event.end?.dateTime && new Date(event.end.dateTime).getTime() !== expected.endAt.getTime()) {
    differences.push("end time");
  }
  if ((event.location ?? "") !== (expected.location ?? "")) differences.push("location");
  if (event.status === "cancelled") differences.push("deletion");

  return { matches: differences.length === 0, differences };
}
