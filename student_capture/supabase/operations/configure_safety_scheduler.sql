-- Run with psql variables; never commit the real secret:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -v worker_url="$SAFETY_WORKER_URL" -v worker_secret="$SAFETY_WORKER_SECRET" \
--   -f supabase/operations/configure_safety_scheduler.sql

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(:'worker_url', 'student_capture_safety_worker_url',
                           'Vercel safety-worker endpoint')
where not exists (select 1 from vault.decrypted_secrets
                   where name = 'student_capture_safety_worker_url');
select vault.update_secret(id, :'worker_url', name, description)
  from vault.decrypted_secrets
 where name = 'student_capture_safety_worker_url';

select vault.create_secret(:'worker_secret', 'student_capture_safety_worker_secret',
                           'Authorization secret for Vercel safety worker')
where not exists (select 1 from vault.decrypted_secrets
                   where name = 'student_capture_safety_worker_secret');
select vault.update_secret(id, :'worker_secret', name, description)
  from vault.decrypted_secrets
 where name = 'student_capture_safety_worker_secret';

select cron.unschedule(jobid) from cron.job
 where jobname in ('student-capture-safety-worker', 'student-capture-safety-watchdog');

select cron.schedule(
  'student-capture-safety-worker', '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
               where name = 'student_capture_safety_worker_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
          where name = 'student_capture_safety_worker_secret')),
      body := '{"source":"supabase-cron"}'::jsonb,
      timeout_milliseconds := 290000
    );
  $job$
);

select cron.schedule(
  'student-capture-safety-watchdog', '*/5 * * * *',
  $job$ select fail_stale_safety_screens(interval '30 minutes'); $job$
);
