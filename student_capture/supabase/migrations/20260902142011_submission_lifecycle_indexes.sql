-- Cover lifecycle foreign keys used by staff and audit lookups.
create index captures_review_started_by_idx on captures (review_started_by)
  where review_started_by is not null;
create index capture_withdrawal_requested_by_idx
  on capture_withdrawal_requests (requested_by, requested_at desc);
create index capture_withdrawal_decided_by_idx
  on capture_withdrawal_requests (decided_by, decided_at desc)
  where decided_by is not null;
