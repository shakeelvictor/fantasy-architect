-- Table grants, stated instead of inherited.
--
-- Until 30 Oct 2026 Supabase granted anon/authenticated/service_role access to
-- every new table in "public" automatically, and 0001–0007 relied on that.
-- From then on a new table gets NO Data API access without an explicit GRANT,
-- and that includes re-running these migrations on a fresh project (a restore
-- after a pause, a preview branch). Without this, a rebuilt project would load
-- no board and log nobody in — auth-pin reads pins as service_role.
--
-- These are exactly the grants the live project already holds (read from
-- information_schema on 20 Oct 2026), so applying it there changes nothing.
-- Broad on purpose: access is decided by RLS, which is on for every table, not
-- by these grants — narrowing them would be a separate decision, not a port.
--
-- Every future table needs its own line here or in its own migration;
-- db.integration.test.ts fails on any public table left ungranted.

grant all on table seasons, teams, pins, draft_events, heartbeat
  to anon, authenticated, service_role;
