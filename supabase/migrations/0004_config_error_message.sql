-- 0003 left one rough edge. RLS filters the UPDATE for anyone who is not the
-- commissioner, so the row simply is not there to update and the function
-- reported "season N does not exist" — true of the statement, misleading to
-- read, and it surfaces verbatim in the settings panel. An expired session
-- would have shown the same thing.
--
-- The policy is still what enforces this; the check below only exists so the
-- refusal explains itself.

create or replace function set_season_config(p_season int, p_config jsonb)
returns jsonb
language plpgsql as $$
declare
  n int := (p_config ->> 'teams')::int; i int;
begin
  if fa_role() is distinct from 'commish' then
    raise exception 'only the commissioner can change the season settings';
  end if;

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
