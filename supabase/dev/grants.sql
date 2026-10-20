-- Supabase-equivalent default privileges for the shimmed roles. Applied
-- AFTER the migration, locally only.
grant usage on schema public, auth to anon, authenticated;
-- NO blanket table grant: from 30 Oct 2026 Supabase stops granting new
-- tables by default, so the migrations must carry their own (0008). Granting
-- every table here would hide a migration that forgot.
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
