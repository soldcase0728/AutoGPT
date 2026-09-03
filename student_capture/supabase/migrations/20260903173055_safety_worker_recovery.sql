-- A watchdog may mark an old pending screen unavailable just before a restored
-- worker leases its job. Re-open only that recoverable failure when work starts.
create or replace function claim_safety_job(p_lease_seconds integer default 120)
returns safety_jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job safety_jobs;
begin
  select * into v_job from safety_jobs
   where (status = 'pending' and available_at <= now())
      or (status = 'processing' and lease_expires_at < now())
   order by available_at, created_at
   for update skip locked limit 1;
  if not found then return null; end if;
  update safety_jobs set status = 'processing', attempt_count = attempt_count + 1,
    lease_token = gen_random_uuid(), heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds))
    where id = v_job.id returning * into v_job;
  update safety_screens set status = 'processing', started_at = coalesce(started_at, now()),
    completed_at = null, error_code = null, error_detail_safe = null,
    attempt_count = greatest(attempt_count, v_job.attempt_count)
    where id = v_job.safety_screen_id
      and (status = 'pending'
        or (status = 'screening_failed' and error_code = 'worker_unavailable'));
  return v_job;
end;
$$;

revoke execute on function claim_safety_job(integer) from public, anon, authenticated;
grant execute on function claim_safety_job(integer) to service_role;
