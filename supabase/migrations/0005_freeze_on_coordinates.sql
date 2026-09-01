-- 0003 froze a season's settings as soon as it had ANY event. That is too
-- blunt, and the hosted 2027 season showed why: it carries a single stray
-- `draft_started` from a test, which bound nothing to the board's shape but
-- locked setup permanently, with no way back that does not involve deleting
-- from an append-only log.
--
-- The real hazard is narrower. What cannot survive a re-shape is an event
-- that already NAMES a slot or a round: a pick (overall/round/slot), a
-- keeper (slot/round), a traded pick (round/slots), a request (slot). Those
-- coordinates were computed under the old config, so changing teams, rounds
-- or type would reinterpret them rather than record a change.
--
-- `draft_started` and `draft_completed` carry no coordinates, so a season
-- that has only been started can still be shaped — which is exactly the
-- accidental-click case that needs to be recoverable.

create or replace function fa_validate_config() returns trigger
language plpgsql as $$
declare
  cfg jsonb := new.config; n int; i int;
begin
  if new.year <> old.year then
    raise exception 'the season year cannot be changed';
  end if;

  if exists (
    select 1 from draft_events
     where season = old.year
       and type not in ('draft_started', 'draft_completed')
  ) then
    raise exception 'season % already has picks, keepers or trades on the board — its settings are frozen', old.year;
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
