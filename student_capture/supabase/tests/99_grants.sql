-- Mirrors the grants Supabase applies to new tables in `public`.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant select, insert on storage.objects to authenticated;
