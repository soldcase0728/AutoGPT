-- Existing rejected captures predate lifecycle timestamps. Start their
-- retention clock at rollout rather than leaving those objects indefinitely.
update captures
   set retention_due_at = now() + interval '30 days'
 where state = 'rejected' and retention_due_at is null;
