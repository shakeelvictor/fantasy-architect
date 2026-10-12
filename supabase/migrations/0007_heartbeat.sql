-- A keep-warm that WRITES.
--
-- keep-warm.yml pinged fold_state() daily from 1 Oct 2026, every run
-- succeeded, and Supabase still emailed on 11 Oct that the project had "not
-- seen sufficient activity for more than 7 days". So a read does not count,
-- or does not count enough. fold_state is `stable`, which PostgREST runs in a
-- READ ONLY transaction: it touches the log but changes nothing, and nothing
-- about it looks like a project in use.
--
-- This gives the ping something real to do: bump one row. It lives in its own
-- table on purpose — draft_events is append-only and every row in it is a
-- league fact, so a heartbeat must never go there.
--
-- Anon may call it. That is safe because all it can do is move one timestamp
-- forward and a counter up; there is no input. The table itself has RLS on and
-- no policies, so the function (security definer) is the only way in.

create table heartbeat (
  id    boolean primary key default true check (id),  -- exactly one row
  at    timestamptz not null default now(),
  beats bigint not null default 0
);
-- enabled but NOT forced (unlike the league tables): forcing would cage the
-- owner too, and the owner is who keep_warm() runs as
alter table heartbeat enable row level security;

create or replace function keep_warm() returns timestamptz
language sql volatile security definer set search_path = public as $$
  insert into heartbeat (id, at, beats) values (true, now(), 1)
  on conflict (id) do update set at = now(), beats = heartbeat.beats + 1
  returning at
$$;

revoke all on function keep_warm() from public;
grant execute on function keep_warm() to anon, authenticated;
