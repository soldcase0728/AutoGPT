-- Sport colours for the calendar.
--
-- A week of team practice rendered as one flat navy, so telling basketball from
-- wrestling meant reading every block. This is the hue each sport carries.
--
-- Nullable on purpose. A sport added after this migration has no slot and falls
-- back to a stable hash of its name, which is a fixed colour rather than a
-- missing one -- the alternative was a NOT NULL default that would have painted
-- every new sport the same.
ALTER TABLE "sports" ADD COLUMN "color_slot" INTEGER;
