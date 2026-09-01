-- What the Supabase platform provides before any migration runs, shimmed for
-- local Postgres (PGlite): auth.jwt() reading the request.jwt.claims GUC —
-- the same mechanism PostgREST uses — plus the client roles. Used by the
-- rules test harness AND the dev API server; never deployed.
create schema auth;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role anon nologin;
create role authenticated nologin;
