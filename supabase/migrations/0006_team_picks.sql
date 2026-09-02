-- Teams draft for themselves.
--
-- Until now a team could express exactly one write — pick_requested — and the
-- commissioner turned it into a pick. That made the commissioner a bottleneck
-- on every single pick of the night: if they stepped away, signed out, or
-- just missed the banner, the board stopped. Nobody should have to be at a
-- laptop for someone else's turn.
--
-- The safety of this rests on something already true rather than on new
-- checks. fa_validate() has always required a pick_made's `slot` to equal
-- fa_owner_of() — the slot actually on the clock — and its `overall` to equal
-- the next pick, for EVERY author including the commissioner. A pick out of
-- turn, for another team, or for a player already gone is unrepresentable no
-- matter who sends it.
--
-- So the only question left for RLS is whose turn it is, and that is one
-- comparison: the row's slot against the caller's own. The two layers compose
-- into "a team may draft when, and only when, it is their turn" without
-- either of them having to know the whole rule.
--
-- What a team still cannot do is unchanged and worth stating: undo, trade,
-- declare keepers, start or complete the draft, resolve anyone's request, or
-- touch a pick for another slot.

create policy team_picks_on_the_clock on draft_events for insert
  with check (
    fa_role() = 'team'
    and type = 'pick_made'
    -- fa_validate has already pinned this to the on-clock slot; equality with
    -- the caller's own slot is therefore "it is my turn"
    and (payload ->> 'slot')::int = fa_slot()
    -- a team never fills a keeper: those chain from the commissioner's
    -- transaction with actor.role = 'system'
    and (payload ->> 'is_keeper')::boolean is not true
    and (actor ->> 'role') = 'team'
    and (actor ->> 'slot')::int = fa_slot()
  );
