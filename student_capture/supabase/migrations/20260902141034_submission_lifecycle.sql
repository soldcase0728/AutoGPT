-- Add lifecycle values in their own committed migration. PostgreSQL does not
-- permit a freshly-added enum value to be used until the transaction that
-- added it has committed.

alter type capture_state add value if not exists 'withdrawal_requested' after 'in_review';
alter type capture_state add value if not exists 'withdrawn' after 'withdrawal_requested';
