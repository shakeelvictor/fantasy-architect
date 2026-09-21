# Fantasy Architect

The draft room for one fantasy football league — 11 teams, 20 rounds,
straight draft, keepers, and a bespoke scoring system no off-the-shelf tool
implements. A personal league tool, not a product. Live at **[fantasy-architect.netlify.app](https://fantasy-architect.netlify.app)**;
any finished draft is readable without a login at `/{year}`, e.g.
**[/2026](https://fantasy-architect.netlify.app/2026)**.

It is a rebuild of a working app. The v1 version (`../fantasy-draft-assistant`,
vanilla JS, archived read-only on GitHub) ran the completed 2026 draft. v2 runs 2027 onward.

## Why it was rebuilt

v1 kept the draft in each browser's localStorage and synced by writing the
whole board back to a blob. On draft night that meant any device could
overwrite the draft — and one did: a Safari tab that had never loaded the
board wrote its empty state over a draft in progress.

The fix is the architecture, not a guard rail. **Every draft action is an
immutable row in Postgres, and the board is a fold over that log.** Every
device folds the same events with the same reducer, so no client ever holds
an authoritative copy to overwrite anything with. The v1 failure is not
defended against; it is unrepresentable.

Two consequences worth stating, because they are the whole point:

- **The rules live in the database.** Every league rule is a `BEFORE INSERT`
  trigger, and permissions are RLS. A pick out of turn, for another team, or
  for a player already gone is refused by Postgres — not by code that
  remembers to check. A team's token can express exactly two writes: a pick
  when its own slot is on the clock, and a request for a player when it is
  not.
- **Losing a device costs nothing.** Close the tab, sign out, run out of
  battery — sign back in and the board rebuilds from the log, identical.

## What it does

**Draft night.** A live board every device sees at once, the player pool with
this league's own valuations (projections re-scored under league rules, value
over replacement, tiers, ADP gaps), a personal queue, suggested picks,
keepers, pick trades, undo/redo, a confirm card before every human pick, and
a pick ticker. Teams draft their own picks; the commissioner can draft for
anyone and is the only one who can undo, trade, or manage keepers.

**The player card.** Bio, this league's rankings, the season outlook and news
from Sleeper, an 18-week matchup strip coloured by how each defence handles
that position, last season's game log re-scored under league rules, and the
full team depth chart.

**Mock drafts.** Bots draft for every other seat and pause on your turn.
Entirely local — the same reducer over a browser-only event list, so a
practice run can never touch the real board.

**After the draft.** Grades per team (value over replacement per pick,
z-scored across the league) with a hot take behind each card, an Excel export,
a push of results into MyFantasyLeague, and an archive of the draft as a
standalone document. Once a season finishes, the Analyzer marks its own
grades against what the drafted players actually scored.

## Layout

```
packages/scoring   the league's scoring engine, ported from v1 and asserted
                   bit-identical over 35,866 golden cases
packages/rules     event types, the reducer, board math — mirrored
                   case-for-case by the SQL fold, with a test proving it
supabase/          migrations (the log, the triggers, RLS), the PIN→JWT
                   edge function, the MyFantasyLeague proxy
tools/bake         the weekly data build: Sleeper → a static player pool
tools/archive      publishes a finished draft as a permanent record
tools/dev-api      the whole platform locally: the real migrations in
                   PGlite, real RLS per request, real JWTs, SSE for realtime
apps/web           React 19 + Vite. v1's stylesheet verbatim, and components
                   emit v1's exact DOM, so the rebuild kept v1's look
```

## Running it

```bash
pnpm install
pnpm --filter @fa/dev-api start     # the platform, in-process
pnpm --filter @fa/web dev           # http://localhost:5173
```

Dev PINs: commissioner `1111`, teams `2201`–`2211`. No cloud account needed —
`tools/dev-api` runs the real migrations in PGlite and enforces the real RLS,
so what passes locally is what the hosted database will do.

## Testing

```bash
pnpm -r test                        # scoring + rules + archive
pnpm --filter @fa/web test          # Playwright, multi-browser
```

- **Scoring**: 35,866 golden cases, bit-identical to the v1 engine on real
  Sleeper data. Strict equality on doubles, never loosened.
- **Rules**: the reducer, and the database driven as the roles the JWTs carry
  — the migrations running in PGlite with RLS enforced per request.
- **End to end**: draft night in two browsers, keepers and trades, the player
  card, mock drafts, exports, the public pages, and the authorization
  boundaries.

New guards are mutation-checked: the test is made to fail on purpose before
it is trusted, because a test that cannot fail proves nothing.
