-- Season setup from the UI: the commissioner can shape next year's draft
-- (teams, rounds, straight/snake, the order) without a hand-written insert.
--
-- Config is NOT an event, deliberately. Every pick's coordinates — its
-- overall, its round, which slot owns it — were computed under the config
-- that was in force when it landed, so changing teams or type after picks
-- exist would silently reinterpret history rather than record a change.
-- Config is therefore seed data that is FROZEN the moment a season has any
-- log at all, and the freeze is enforced here rather than in the client,
-- for the same reason the league rules are a trigger: the database is the
-- only place every path has to go through.

create or replace function fa_validate_config() returns trigger
language plpgsql as $$
declare
  cfg jsonb := new.config; n int; i int;
begin
  if new.year <> old.year then
    raise exception 'the season year cannot be changed';
  end if;

  -- Frozen once anything has happened. Checked even for the commissioner:
  -- there is no correct way to re-shape a board that already has picks on
  -- it, so this is a rule and not a permission.
  if exists (select 1 from draft_events where season = old.year) then
    raise exception 'season % already has a draft log — its settings are frozen', old.year;
  end if;

  if (cfg ->> 'type') is null or (cfg ->> 'type') not in ('linear', 'snake') then
    raise exception 'type must be linear or snake';
  end if;
  n := (cfg ->> 'teams')::int;
  if n is null or n < 2 or n > 16 then
    raise exception 'teams must be between 2 and 16';
  end if;
  if (cfg ->> 'rounds')::int is null or (cfg ->> 'rounds')::int < 1 or (cfg ->> 'rounds')::int > 30 then
    raise exception 'rounds must be between 1 and 30';
  end if;
  if jsonb_typeof(cfg -> 'order') <> 'array' or jsonb_array_length(cfg -> 'order') <> n then
    raise exception 'the draft order must name all % teams', n;
  end if;
  for i in 0 .. n - 1 loop
    if coalesce(btrim(cfg -> 'order' ->> i), '') = '' then
      raise exception 'every slot needs a name (slot % is blank)', i + 1;
    end if;
  end loop;

  return new;
end $$;

create trigger seasons_validate_config
  before update on seasons
  for each row execute function fa_validate_config();

-- Only the commissioner may re-shape a season. Spectators and team PINs
-- keep the read-only access seasons_read already grants them.
create policy seasons_commish_update on seasons for update
  using (fa_role() = 'commish')
  with check (fa_role() = 'commish');

-- The `teams` rows are the commissioner's own league metadata (each slot's
-- owner and MFL franchise id). They are not draft state — nothing in the
-- board math reads them — so they carry no freeze, just the same commish-only
-- boundary. Everyone keeps the read access teams_read already grants.
create policy teams_commish_write on teams for all
  using (fa_role() = 'commish')
  with check (fa_role() = 'commish');

-- The write path, mirroring submit_event: SECURITY INVOKER on purpose, so
-- the policy above and the trigger both apply to it. It also keeps the
-- `teams` rows in step with the order — they carry each slot's MFL
-- franchise id, so slots are updated in place and only genuinely removed
-- slots are deleted.
create or replace function set_season_config(p_season int, p_config jsonb)
returns jsonb
language plpgsql as $$
declare
  n int := (p_config ->> 'teams')::int; i int;
begin
  update seasons set config = p_config where year = p_season;
  if not found then
    raise exception 'season % does not exist', p_season;
  end if;

  for i in 1 .. n loop
    insert into teams (season, slot, owner)
    values (p_season, i, btrim(p_config -> 'order' ->> (i - 1)))
    on conflict (season, slot) do update set owner = excluded.owner;
  end loop;
  delete from teams where season = p_season and slot > n;

  return jsonb_build_object('status', 'saved', 'config', p_config);
end $$;
