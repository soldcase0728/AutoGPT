-- Mirrors broad hosted table grants so RLS is still exercised. Function
-- execution stays exactly as the migrations declare it; granting every RPC to
-- anon here would hide an authorization regression.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;
grant select, insert on storage.objects to authenticated;
