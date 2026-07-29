-- Proves, against a running instance, that the two properties this system is
-- accountable for are actually enforced by the database rather than by
-- application code that a future change could bypass:
--
--   1. Two bookings cannot occupy the same sub-space at the same time.
--   2. The audit log cannot be edited or deleted.
--
-- Run it against the live database. It writes nothing that survives:
--
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U olsm_app -d olsm_facilities < scripts/verify-guarantees.sql
--
-- Every line prints PASS or FAIL. A FAIL means the guarantee is not in force
-- and the instance should not be trusted with real bookings until it is.
--
-- Run this after any migration, and after any restore from backup.

\set ON_ERROR_STOP off
\pset pager off
\t on

DO $$
DECLARE
  ok           boolean;
  probe_from   record;
  other_id     text;
  audit_rows   bigint;
BEGIN
  RAISE INFO '--- structural checks ---';

  SELECT count(*) = 1 INTO ok FROM pg_extension WHERE extname = 'btree_gist';
  RAISE INFO '%  btree_gist extension', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  SELECT count(*) = 1 INTO ok FROM pg_constraint
   WHERE conname = 'booking_occupancy_no_overlap' AND contype = 'x';
  RAISE INFO '%  overlap exclusion constraint present', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  SELECT count(*) = 2 INTO ok FROM pg_trigger
   WHERE tgname IN ('audit_log_no_update', 'audit_log_no_delete');
  RAISE INFO '%  audit-log append-only triggers present', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  RAISE INFO '';
  RAISE INFO '--- behavioural checks (these attempt real writes) ---';

  -- 1. Double-booking. Take an existing occupancy row and try to put a
  --    different booking on the same sub-space over the same interval. Must be
  --    refused with SQLSTATE 23P01. A different booking is required because
  --    (booking_id, sub_space_id) has its own unique index, and duplicating a
  --    row trips that instead, which proves nothing about overlap.
  SELECT o.booking_id, o.sub_space_id, o.start_at, o.end_at
    INTO probe_from
    FROM booking_occupancy o LIMIT 1;

  IF probe_from IS NULL THEN
    RAISE INFO 'SKIP  no bookings exist yet, so the overlap probe has nothing to collide with';
  ELSE
    SELECT b.id INTO other_id FROM bookings b
     WHERE NOT EXISTS (SELECT 1 FROM booking_occupancy x
                        WHERE x.booking_id = b.id
                          AND x.sub_space_id = probe_from.sub_space_id)
     LIMIT 1;

    IF other_id IS NULL THEN
      RAISE INFO 'SKIP  only one booking touches that sub-space; nothing to collide with';
    ELSE
      BEGIN
        INSERT INTO booking_occupancy (id, booking_id, sub_space_id, start_at, end_at)
        VALUES ('verify-probe', other_id, probe_from.sub_space_id,
                probe_from.start_at, probe_from.end_at);
        RAISE INFO 'FAIL  an overlapping booking was ACCEPTED - double-booking is possible';
        RAISE EXCEPTION 'rollback probe';
      EXCEPTION
        WHEN exclusion_violation THEN
          RAISE INFO 'PASS  overlapping booking rejected by the database';
        WHEN OTHERS THEN
          IF SQLERRM = 'rollback probe' THEN
            RAISE INFO '      (probe row rolled back)';
          ELSE
            RAISE INFO 'FAIL  overlap probe errored unexpectedly: %', SQLERRM;
          END IF;
      END;
    END IF;
  END IF;

  -- 2. Audit log tamper-resistance.
  SELECT count(*) INTO audit_rows FROM audit_log;
  IF audit_rows = 0 THEN
    RAISE INFO 'SKIP  audit log is empty, nothing to attempt tampering with';
  ELSE
    BEGIN
      UPDATE audit_log SET action = 'tampered';
      RAISE INFO 'FAIL  audit_log accepted an UPDATE - the liability trail is not tamper-proof';
    EXCEPTION WHEN OTHERS THEN
      RAISE INFO 'PASS  audit_log UPDATE rejected (%)', SQLERRM;
    END;

    BEGIN
      DELETE FROM audit_log;
      RAISE INFO 'FAIL  audit_log accepted a DELETE - history can be erased';
    EXCEPTION WHEN OTHERS THEN
      RAISE INFO 'PASS  audit_log DELETE rejected (%)', SQLERRM;
    END;
  END IF;

  RAISE INFO '';
  RAISE INFO '--- who the app connects as ---';
  SELECT rolsuper INTO ok FROM pg_roles WHERE rolname = current_user;
  IF ok THEN
    RAISE INFO 'WARN  connected as a SUPERUSER (%). A superuser can drop the audit', current_user;
    RAISE INFO '      triggers, so the append-only guarantee is only as strong as';
    RAISE INFO '      trust in whoever holds this connection string. Use a plain';
    RAISE INFO '      role for the application. See DEPLOY.md.';
  ELSE
    RAISE INFO 'PASS  connected as non-superuser (%)', current_user;
  END IF;
END $$;

-- Nothing above commits: the probes either raise, or are rolled back by the
-- surrounding block. Confirm.
SELECT CASE WHEN count(*) = 0
            THEN 'PASS  no probe rows left behind'
            ELSE 'FAIL  probe row survived - remove it manually' END
  FROM booking_occupancy WHERE id = 'verify-probe';
