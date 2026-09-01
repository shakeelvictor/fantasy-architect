-- Fantasy Architect 2.0 — foundation migration.
--
-- The core model: every draft mutation is an immutable row in draft_events;
-- current state is a fold over the log (fa_fold), and every league rule from
-- v1 — max-2 keepers, one per round, kept picks untradeable, pick ownership
-- following trades, on-the-clock order — is enforced by a BEFORE INSERT
-- trigger on the table itself. The submit_event() RPC is a convenience
-- wrapper (idempotency, keeper chaining, undo cascade); the trigger is the
-- wall. Even a hand-crafted INSERT from a role the policies allow cannot
-- corrupt the draft.
--
-- Authorization: auth.jwt() carries {app_role: 'commish'|'team', app_slot}.
-- (Custom claim names — `role` itself is Supabase's Postgres-role claim.)
-- RLS WITH CHECK policies make a team writing outside its slot
-- unrepresentable; deny-by-default everywhere else.
--
-- auth.jwt() is provided by Supabase in production. The local test harness
-- shims it (test/harness.sql) before applying this file.

-- ---------------------------------------------------------------- schema

create table seasons (
  year         int primary key,
  -- {teams: 11, rounds: 20, type: 'linear'|'snake', order: [names...]}
  config       jsonb not null
);

create table teams (
  season            int  not null references seasons(year) on delete cascade,
  slot              int  not null,
  owner             text not null,
  mfl_franchise_id  text,
  primary key (season, slot)
);

-- PIN credentials. Never readable by clients — only the auth-pin edge
-- function (service role) touches this table.
create table pins (
  id        bigint generated always as identity primary key,
  season    int  not null references seasons(year) on delete cascade,
  role      text not null check (role in ('commish', 'team')),
  slot      int,
  salt      text not null,
  pin_hash  text not null, -- sha256(salt || pin), hex
  check ((role = 'team') = (slot is not null))
);

create table draft_events (
  seq              bigint generated always as identity primary key,
  season           int   not null references seasons(year) on delete cascade,
  type             text  not null check (type in (
                     'draft_started', 'pick_requested', 'pick_request_resolved',
                     'pick_made', 'pick_undone', 'keeper_declared', 'keeper_removed',
                     'pick_traded', 'trade_reverted', 'player_moved', 'draft_completed')),
  actor            jsonb not null,
  payload          jsonb not null default '{}',
  idempotency_key  text  not null unique,
  created_at       timestamptz not null default now()
);

create index draft_events_season_seq on draft_events (season, seq);

-- ------------------------------------------------------------ jwt helpers

create or replace function fa_role() returns text
language sql stable as $$
  select auth.jwt() ->> 'app_role'
$$;

create or replace function fa_slot() returns int
language sql stable as $$
  select (auth.jwt() ->> 'app_slot')::int
$$;

-- ---------------------------------------------------------- board math
-- Ports v1's overallForSlotRound / slotForOverall exactly (snake supported
-- to keep the math faithful, though the league is straight-order).

create or replace function fa_overall_for(p_config jsonb, p_slot int, p_round int)
returns int language sql immutable as $$
  select (p_round - 1) * (p_config ->> 'teams')::int
       + case when p_config ->> 'type' = 'snake' and p_round % 2 = 0
              then (p_config ->> 'teams')::int - p_slot
              else p_slot - 1 end
       + 1
$$;

create or replace function fa_board_slot(p_config jsonb, p_overall int)
returns int language sql immutable as $$
  select case when p_config ->> 'type' = 'snake'
              and ((p_overall - 1) / (p_config ->> 'teams')::int + 1) % 2 = 0
         then (p_config ->> 'teams')::int - ((p_overall - 1) % (p_config ->> 'teams')::int)
         else ((p_overall - 1) % (p_config ->> 'teams')::int) + 1 end
$$;

create or replace function fa_round_of(p_config jsonb, p_overall int)
returns int language sql immutable as $$
  select (p_overall - 1) / (p_config ->> 'teams')::int + 1
$$;

-- ------------------------------------------------------------- the fold
-- Mirrors packages/rules applyEvent — the two are cross-checked in CI.
-- State: { started, completed, picks: [...], keepers: [...], trades: [...],
--          requests: [...] }

create or replace function fa_fold(p_season int) returns jsonb
language plpgsql stable as $$
declare
  st jsonb := jsonb_build_object(
    'started', false, 'completed', false,
    'picks', '[]'::jsonb, 'keepers', '[]'::jsonb,
    'trades', '[]'::jsonb, 'requests', '[]'::jsonb);
  e record;
  o int;
begin
  for e in
    select seq, type, payload from draft_events
    where season = p_season order by seq
  loop
    case e.type
      when 'draft_started' then
        st := jsonb_set(st, '{started}', 'true');
      when 'draft_completed' then
        st := jsonb_set(st, '{completed}', 'true');
      when 'pick_made' then
        st := jsonb_set(st, '{picks}', (st -> 'picks') || jsonb_build_array(e.payload));
      when 'pick_undone' then
        o := (e.payload ->> 'overall')::int;
        st := jsonb_set(st, '{picks}', coalesce(
          (select jsonb_agg(p) from jsonb_array_elements(st -> 'picks') p
            where (p ->> 'overall')::int <> o), '[]'::jsonb));
      when 'keeper_declared' then
        -- re-declaring a kept player moves him (v1 keeper-op semantics)
        st := jsonb_set(st, '{keepers}', coalesce(
          (select jsonb_agg(k) from jsonb_array_elements(st -> 'keepers') k
            where k ->> 'pid' <> e.payload ->> 'pid'), '[]'::jsonb)
          || jsonb_build_array(e.payload));
      when 'keeper_removed' then
        st := jsonb_set(st, '{keepers}', coalesce(
          (select jsonb_agg(k) from jsonb_array_elements(st -> 'keepers') k
            where k ->> 'pid' <> e.payload ->> 'pid'), '[]'::jsonb));
      when 'pick_traded' then
        -- latest trade for a (round, from_slot) pick replaces the previous
        st := jsonb_set(st, '{trades}', coalesce(
          (select jsonb_agg(t) from jsonb_array_elements(st -> 'trades') t
            where not ((t ->> 'round')::int = (e.payload ->> 'round')::int
                   and (t ->> 'from_slot')::int = (e.payload ->> 'from_slot')::int)),
          '[]'::jsonb) || jsonb_build_array(e.payload));
      when 'trade_reverted' then
        st := jsonb_set(st, '{trades}', coalesce(
          (select jsonb_agg(t) from jsonb_array_elements(st -> 'trades') t
            where not ((t ->> 'round')::int = (e.payload ->> 'round')::int
                   and (t ->> 'from_slot')::int = (e.payload ->> 'from_slot')::int)),
          '[]'::jsonb));
      when 'pick_requested' then
        st := jsonb_set(st, '{requests}', (st -> 'requests')
          || jsonb_build_array(e.payload || jsonb_build_object('seq', e.seq, 'resolved', false)));
      when 'pick_request_resolved' then
        st := jsonb_set(st, '{requests}', coalesce(
          (select jsonb_agg(
             case when (r ->> 'seq')::bigint = (e.payload ->> 'request_seq')::bigint
                  then r || jsonb_build_object('resolved', true,
                                               'accepted', (e.payload ->> 'accepted')::boolean)
                  else r end)
            from jsonb_array_elements(st -> 'requests') r), '[]'::jsonb));
      else null; -- player_moved reshapes rosters post-hoc; no fold state yet
    end case;
  end loop;
  return st;
end $$;

-- Owner of a pick = board slot, unless a trade moved it.
create or replace function fa_owner_of(p_config jsonb, p_state jsonb, p_overall int)
returns int language plpgsql stable as $$
declare
  s int := fa_board_slot(p_config, p_overall);
  r int := fa_round_of(p_config, p_overall);
  t jsonb;
begin
  select x into t from jsonb_array_elements(p_state -> 'trades') x
    where (x ->> 'round')::int = r and (x ->> 'from_slot')::int = s;
  if t is not null then return (t ->> 'to_slot')::int; end if;
  return s;
end $$;

-- --------------------------------------------------------- the guards
-- One validation wall, run by a BEFORE INSERT trigger. Every invariant the
-- v1 selftest pinned lives here; the RPC cannot bypass it and neither can a
-- direct INSERT from an allowed role.

create or replace function fa_validate() returns trigger
language plpgsql as $$
declare
  cfg    jsonb;
  st     jsonb;
  teams  int;
  rounds int;
  cur    int;
  o      int;
  r      int;
  k      jsonb;
  req    jsonb;
begin
  select config into cfg from seasons where year = new.season;
  if cfg is null then raise exception 'unknown season %', new.season; end if;
  teams  := (cfg ->> 'teams')::int;
  rounds := (cfg ->> 'rounds')::int;
  st  := fa_fold(new.season);
  cur := jsonb_array_length(st -> 'picks') + 1;

  if (st ->> 'completed')::boolean and new.type <> 'pick_undone' then
    raise exception 'the draft is complete';
  end if;

  case new.type
    when 'draft_started' then
      if (st ->> 'started')::boolean then raise exception 'draft already started'; end if;

    when 'draft_completed' then
      if cur - 1 <> teams * rounds then
        raise exception 'draft is not complete: % of % picks made', cur - 1, teams * rounds;
      end if;

    when 'pick_made' then
      if not (st ->> 'started')::boolean then raise exception 'draft has not started'; end if;
      o := (new.payload ->> 'overall')::int;
      if cur > teams * rounds then
        raise exception 'the board is full — no picks left';
      end if;
      if o is null or o <> cur then
        raise exception 'pick out of turn: expected overall %, got %', cur, o;
      end if;
      if (new.payload ->> 'slot')::int <> fa_owner_of(cfg, st, o) then
        raise exception 'pick #% belongs to slot %, not slot %',
          o, fa_owner_of(cfg, st, o), (new.payload ->> 'slot')::int;
      end if;
      if (new.payload ->> 'round')::int <> fa_round_of(cfg, o) then
        raise exception 'wrong round for overall %', o;
      end if;
      if exists (select 1 from jsonb_array_elements(st -> 'picks') p
                  where p ->> 'pid' = new.payload ->> 'pid') then
        raise exception 'player % is already drafted', new.payload ->> 'pid';
      end if;
      select x into k from jsonb_array_elements(st -> 'keepers') x
        where x ->> 'pid' = new.payload ->> 'pid';
      if (new.payload ->> 'is_keeper')::boolean then
        -- a keeper fill must match the registered keeper owed at exactly this pick
        if k is null
           or (k ->> 'slot')::int <> (new.payload ->> 'slot')::int
           or fa_overall_for(cfg, (k ->> 'slot')::int, (k ->> 'round')::int) <> o then
          raise exception 'no keeper is owed at pick #%', o;
        end if;
      elsif k is not null then
        raise exception 'player % is a registered keeper and off the board', new.payload ->> 'pid';
      end if;

    when 'pick_undone' then
      o := (new.payload ->> 'overall')::int;
      if cur = 1 then raise exception 'nothing to undo'; end if;
      if o <> (select max((p ->> 'overall')::int)
                 from jsonb_array_elements(st -> 'picks') p) then
        raise exception 'only the last pick can be undone';
      end if;

    when 'keeper_declared' then
      r := (new.payload ->> 'round')::int;
      if r is null or r < 1 or r > rounds then raise exception 'round % is outside this draft', r; end if;
      if (new.payload ->> 'slot')::int < 1 or (new.payload ->> 'slot')::int > teams then
        raise exception 'team slot out of range';
      end if;
      -- one keeper per team per round (a re-declared pid is a move, not a clash)
      if exists (select 1 from jsonb_array_elements(st -> 'keepers') x
                  where (x ->> 'slot')::int = (new.payload ->> 'slot')::int
                    and (x ->> 'round')::int = r
                    and x ->> 'pid' <> new.payload ->> 'pid') then
        raise exception 'slot % already keeps someone in round %', new.payload ->> 'slot', r;
      end if;
      -- the league max of two
      if (select count(*) from jsonb_array_elements(st -> 'keepers') x
           where (x ->> 'slot')::int = (new.payload ->> 'slot')::int
             and x ->> 'pid' <> new.payload ->> 'pid') >= 2 then
        raise exception 'slot % already has 2 keepers — the league max', new.payload ->> 'slot';
      end if;
      -- you can't keep with a pick you no longer own…
      o := fa_overall_for(cfg, (new.payload ->> 'slot')::int, r);
      if fa_owner_of(cfg, st, o) <> (new.payload ->> 'slot')::int then
        raise exception 'slot % traded away their R% pick, so it cannot be spent on a keeper',
          new.payload ->> 'slot', r;
      end if;
      -- …or with a pick already used, or keep a player already gone
      if exists (select 1 from jsonb_array_elements(st -> 'picks') p
                  where (p ->> 'overall')::int = o) then
        raise exception 'pick #% has already been used', o;
      end if;
      if exists (select 1 from jsonb_array_elements(st -> 'picks') p
                  where p ->> 'pid' = new.payload ->> 'pid') then
        raise exception 'player % has already been drafted', new.payload ->> 'pid';
      end if;

    when 'keeper_removed' then
      select x into k from jsonb_array_elements(st -> 'keepers') x
        where x ->> 'pid' = new.payload ->> 'pid';
      if k is null then raise exception 'no such keeper'; end if;
      if exists (select 1 from jsonb_array_elements(st -> 'picks') p
                  where p ->> 'pid' = new.payload ->> 'pid' and (p ->> 'is_keeper')::boolean) then
        raise exception 'that keeper is already on the board — undo the pick instead';
      end if;

    when 'pick_traded' then
      r := (new.payload ->> 'round')::int;
      if r is null or r < 1 or r > rounds then raise exception 'round % is outside this draft', r; end if;
      if (new.payload ->> 'from_slot')::int = (new.payload ->> 'to_slot')::int then
        raise exception 'same team on both sides';
      end if;
      if (new.payload ->> 'from_slot')::int not between 1 and teams
         or (new.payload ->> 'to_slot')::int not between 1 and teams then
        raise exception 'team slot out of range';
      end if;
      o := fa_overall_for(cfg, (new.payload ->> 'from_slot')::int, r);
      if exists (select 1 from jsonb_array_elements(st -> 'picks') p
                  where (p ->> 'overall')::int = o) then
        raise exception 'pick #% is already used — move the player instead', o;
      end if;
      -- a pick spent on a keeper is not the team''s to trade
      if exists (select 1 from jsonb_array_elements(st -> 'keepers') x
                  where (x ->> 'slot')::int = (new.payload ->> 'from_slot')::int
                    and (x ->> 'round')::int = r) then
        raise exception 'slot %''s R% pick is spent on a keeper — a kept pick cannot be traded',
          new.payload ->> 'from_slot', r;
      end if;

    when 'trade_reverted' then
      if not exists (select 1 from jsonb_array_elements(st -> 'trades') t
                      where (t ->> 'round')::int = (new.payload ->> 'round')::int
                        and (t ->> 'from_slot')::int = (new.payload ->> 'from_slot')::int) then
        raise exception 'no such trade to revert';
      end if;

    when 'pick_requested' then
      if not (st ->> 'started')::boolean then raise exception 'draft has not started'; end if;
      if exists (select 1 from jsonb_array_elements(st -> 'picks') p
                  where p ->> 'pid' = new.payload ->> 'pid')
         or exists (select 1 from jsonb_array_elements(st -> 'keepers') x
                  where x ->> 'pid' = new.payload ->> 'pid') then
        raise exception 'player % is not available', new.payload ->> 'pid';
      end if;

    when 'pick_request_resolved' then
      select x into req from jsonb_array_elements(st -> 'requests') x
        where (x ->> 'seq')::bigint = (new.payload ->> 'request_seq')::bigint;
      if req is null then raise exception 'no such request'; end if;
      if (req ->> 'resolved')::boolean then raise exception 'request already resolved'; end if;

    else null;
  end case;

  return new;
end $$;

create trigger draft_events_validate
  before insert on draft_events
  for each row execute function fa_validate();

-- ------------------------------------------------------ keeper chaining
-- When the draft reaches a pick a registered keeper is owed at, the pick is
-- consumed automatically — consecutive keepers chain in one pass, exactly
-- like v1's applyDueKeepers.

create or replace function fa_apply_due_keepers(p_season int) returns int
language plpgsql as $$
declare
  cfg jsonb; st jsonb; cur int; k jsonb; applied int := 0;
begin
  select config into cfg from seasons where year = p_season;
  loop
    st  := fa_fold(p_season);
    cur := jsonb_array_length(st -> 'picks') + 1;
    exit when cur > (cfg ->> 'teams')::int * (cfg ->> 'rounds')::int;
    select x into k from jsonb_array_elements(st -> 'keepers') x
      where fa_overall_for(cfg, (x ->> 'slot')::int, (x ->> 'round')::int) = cur;
    exit when k is null;
    insert into draft_events (season, type, actor, payload, idempotency_key)
    values (p_season, 'pick_made', jsonb_build_object('role', 'system'),
            jsonb_build_object('pid', k ->> 'pid', 'overall', cur,
              'round', (k ->> 'round')::int, 'slot', (k ->> 'slot')::int,
              'is_keeper', true),
            'keeper-fill-' || p_season || '-' || cur || '-' || gen_random_uuid());
    applied := applied + 1;
  end loop;
  return applied;
end $$;

-- --------------------------------------------------------------- the RPC
-- Convenience wrapper over the trigger-guarded table: idempotency, actor
-- stamping from the JWT, server-computed pick coordinates, keeper chaining,
-- and the undo cascade (trailing keeper fills pop with the pick, as in v1).
-- SECURITY INVOKER on purpose: RLS policies apply to every insert it makes.

create or replace function submit_event(
  p_season int, p_key text, p_type text, p_payload jsonb default '{}'
) returns jsonb
language plpgsql as $$
declare
  cfg jsonb; st jsonb; cur int; actor jsonb;
  new_seq bigint; derived int := 0; o int; req jsonb; body jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('fa-draft-' || p_season));

  select seq into new_seq from draft_events where idempotency_key = p_key;
  if new_seq is not null then
    return jsonb_build_object('status', 'duplicate', 'seq', new_seq);
  end if;

  select config into cfg from seasons where year = p_season;
  st    := fa_fold(p_season);
  cur   := jsonb_array_length(st -> 'picks') + 1;
  actor := jsonb_build_object('role', fa_role(), 'slot', fa_slot());
  body  := p_payload;

  if p_type = 'pick_made' then
    -- the client names a player; the server decides where the pick lands
    body := jsonb_build_object('pid', p_payload ->> 'pid', 'overall', cur,
      'round', fa_round_of(cfg, cur), 'slot', fa_owner_of(cfg, st, cur),
      'is_keeper', false);

  elsif p_type = 'pick_undone' then
    -- pop trailing keeper fills first, then the last real pick — one command
    for o in
      select (p ->> 'overall')::int from jsonb_array_elements(st -> 'picks') p
      order by (p ->> 'overall')::int desc
    loop
      insert into draft_events (season, type, actor, payload, idempotency_key)
      values (p_season, 'pick_undone', actor, jsonb_build_object('overall', o),
              p_key || '-u' || o)
      returning seq into new_seq;
      derived := derived + 1;
      exit when not (
        select (p ->> 'is_keeper')::boolean from jsonb_array_elements(st -> 'picks') p
         where (p ->> 'overall')::int = o);
    end loop;
    return jsonb_build_object('status', 'applied', 'seq', new_seq, 'derived', derived - 1);

  elsif p_type = 'pick_request_resolved' and (p_payload ->> 'accepted')::boolean then
    select x into req from jsonb_array_elements(st -> 'requests') x
      where (x ->> 'seq')::bigint = (p_payload ->> 'request_seq')::bigint;
    if req is not null and fa_owner_of(cfg, st, cur) <> (req ->> 'slot')::int then
      raise exception 'slot % is not on the clock', req ->> 'slot';
    end if;
  end if;

  insert into draft_events (season, type, actor, payload, idempotency_key)
  values (p_season, p_type, actor, body, p_key)
  returning seq into new_seq;

  -- an accepted request becomes a real pick for the requesting team
  if p_type = 'pick_request_resolved' and (p_payload ->> 'accepted')::boolean then
    insert into draft_events (season, type, actor, payload, idempotency_key)
    values (p_season, 'pick_made', actor,
      jsonb_build_object('pid', req ->> 'pid', 'overall', cur,
        'round', fa_round_of(cfg, cur), 'slot', fa_owner_of(cfg, st, cur),
        'is_keeper', false, 'via_request', (req ->> 'seq')::bigint),
      p_key || '-pick');
    derived := derived + 1;
  end if;

  if p_type in ('draft_started', 'pick_made', 'pick_request_resolved') then
    derived := derived + fa_apply_due_keepers(p_season);
  end if;

  return jsonb_build_object('status', 'applied', 'seq', new_seq, 'derived', derived);
end $$;

-- Read-side helper so any client (spectators included) can fetch the folded
-- state without reimplementing the reducer — and so tests can cross-check
-- the TS reducer against it.
create or replace function fold_state(p_season int) returns jsonb
language sql stable as $$ select fa_fold(p_season) $$;

-- ------------------------------------------------------------------ RLS

alter table seasons       enable row level security;
alter table teams         enable row level security;
alter table pins          enable row level security;
alter table draft_events  enable row level security;
alter table seasons       force row level security;
alter table teams         force row level security;
alter table pins          force row level security;
alter table draft_events  force row level security;

-- reference data and the log are readable by everyone, spectator link included
create policy seasons_read on seasons for select using (true);
create policy teams_read   on teams   for select using (true);
create policy events_read  on draft_events for select using (true);
-- pins: NO policies — nobody reads or writes through the API; the auth-pin
-- edge function uses the service role, which bypasses RLS.

-- a team may do exactly one thing: ask for a player, for its own slot
create policy team_requests on draft_events for insert
  with check (
    fa_role() = 'team'
    and type = 'pick_requested'
    and (payload ->> 'slot')::int = fa_slot()
    and (actor ->> 'role') = 'team'
    and (actor ->> 'slot')::int = fa_slot()
  );

-- the commissioner writes everything else (and keeper fills ride commish
-- transactions with actor.role = 'system' for the audit trail)
create policy commish_writes on draft_events for insert
  with check (
    fa_role() = 'commish'
    and type in ('draft_started', 'pick_made', 'pick_undone', 'pick_request_resolved',
                 'keeper_declared', 'keeper_removed', 'pick_traded', 'trade_reverted',
                 'player_moved', 'draft_completed')
  );

-- no UPDATE or DELETE policies exist on draft_events: the log is append-only
-- for every client role. Corrections are compensating events.
