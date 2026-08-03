-- Remove Google Calendar push-sync and security deposits.
--
-- Three features came out of the application in one pass, on the grounds that
-- fifty people will not miss any of them and all three were code somebody would
-- otherwise have to maintain and explain.
--
--   * Weather. A forecast fetch and a bulk cancel-a-day screen. Nothing to drop
--     here: facilities.weather_dependent stays, because "this field is affected
--     by weather" is useful on a public page whether or not the software calls
--     the rain-out. A rained-out booking is now cancelled the ordinary way, and
--     the administrator's existing waive-the-window tick refunds it in full.
--
--   * Google Calendar push-sync. Two-way sync with renewable webhook channels,
--     bought so an edit in Google could flow back into the booking record --
--     which is not a thing anyone wanted. The read-only iCal feeds remain and
--     are the better mechanism: a subscribed feed reaches Google Calendar,
--     Outlook and a phone, and cannot desynchronise because it flows one way.
--
--   * Security deposits. A manual-capture Stripe authorisation, released or
--     captured by hand after the rental. A card authorisation lapses after
--     about seven days, so for a rental booked two months out the hold was
--     worthless by the date it was meant to cover: a control in appearance
--     only. The quoted amount goes too. An invoice line reading "refundable
--     security deposit" when nothing authorises or captures one is a promise
--     the system does not keep.
--
-- No money changes. The deposit was never part of invoices.total_cents -- it
-- was authorised separately and filtered out of the Stripe Checkout line items
-- -- so every charged amount is exactly what it was before.

-- Calendar sync ------------------------------------------------------------

ALTER TABLE "bookings"
  DROP COLUMN IF EXISTS "google_event_id",
  DROP COLUMN IF EXISTS "google_calendar_id",
  DROP COLUMN IF EXISTS "calendar_sync_status",
  DROP COLUMN IF EXISTS "calendar_sync_error",
  DROP COLUMN IF EXISTS "calendar_sync_version";

ALTER TABLE "facilities"
  DROP COLUMN IF EXISTS "google_calendar_id",
  DROP COLUMN IF EXISTS "google_channel_id",
  DROP COLUMN IF EXISTS "google_resource_id",
  DROP COLUMN IF EXISTS "google_channel_expiry";

DROP TYPE IF EXISTS "CalendarSyncStatus";

-- Queued calendar work that now has no handler. Left in place these would be
-- retried on every sweep and eventually reported as permanently failed jobs.
DELETE FROM "job_queue" WHERE "kind" LIKE 'calendar.%';

-- Deposits -----------------------------------------------------------------

-- Added by 20260728220000_participant_waivers; it references both deposit
-- columns, so it has to go before either of them.
ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_deposit_capture_within_hold";

ALTER TABLE "invoices"
  DROP COLUMN IF EXISTS "deposit_cents",
  DROP COLUMN IF EXISTS "deposit_intent_id",
  DROP COLUMN IF EXISTS "deposit_captured_cents",
  DROP COLUMN IF EXISTS "deposit_resolved_at",
  DROP COLUMN IF EXISTS "deposit_capture_reason";

ALTER TABLE "rate_cards"
  DROP COLUMN IF EXISTS "deposit_cents";

-- Deposit lines already written into an issued invoice's line_items JSON. The
-- column is the invoice's record of what was billed, and leaving a deposit line
-- there would keep it on screen and in the total column of any invoice printed
-- from here on.
UPDATE "invoices"
SET "line_items" = (
  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  FROM jsonb_array_elements("line_items") AS item
  WHERE item->>'kind' IS DISTINCT FROM 'deposit'
)
WHERE "line_items" @> '[{"kind": "deposit"}]'::jsonb;
