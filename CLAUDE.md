# CLAUDE.md — fantasy-architect (v2)

The ground-up rebuild of the INDOMEXPAK draft tool. Owner: Shakeel ("Shak",
league slot 11). The v1 app lives in `../fantasy-draft-assistant` — **frozen,
deployed, and it ran the completed 2026 draft**; read its CLAUDE.md for league
rules (11 teams, 20 rounds, STRAIGHT draft, max-2 keepers, bespoke fflr
scoring). v2 runs the 2027 draft.

## The one architectural idea

Every draft mutation is an immutable row in Postgres (`draft_events`,
Supabase). State = a fold over the log. Every browser folds the same log via
the shared reducer (`@fa/rules`), so every device renders the same board —
the v1 failure class where an empty Safari overwrote a finished draft is
unrepresentable. League rules are a BEFORE INSERT trigger (`fa_validate` in
`supabase/migrations/0001_foundation.sql`); the `submit_event()` RPC adds
idempotency keys, keeper auto-fill chaining, and the undo cascade. RLS: a
team JWT can express exactly one write — `pick_requested` for its own slot;
spectators read everything with the anon key; the log is append-only for
everyone (corrections are compensating events).

## Layout

- `packages/scoring` — TS port of v1's rules engine. 35,866 golden cases
  assert BIT-IDENTICAL output vs the v1 engine (strict `toBe` on doubles —
  never loosen). The probability-weighted per-game bonus tiers are the #1
  thing a "cleanup" would silently break.
- `packages/rules` — event types + `applyEvent` reducer (mirrors the SQL
  fold case-for-case; a test asserts identical state) + board math +
  `rosterBalance`. DB integration tests run the REAL migration in PGlite
  with RLS enforced via SET ROLE (`test/harness.ts` + `supabase/dev/*.sql`).
- `supabase/` — migrations (0001 foundation, 0002 realtime publication,
  0003–0005 season settings: the commissioner can re-shape a season from the
  UI, guarded by a BEFORE UPDATE trigger + commish-only RLS. Config is NOT an
  event — every pick's coordinates were computed under the config in force
  when it landed — so it FREEZES once the season has any event that names a
  slot or round (picks, keepers, trades, requests). `draft_started` alone does
  not freeze it, so an accidental start stays recoverable),
  `auth-pin` edge function (PIN → 24h HS256 JWT with app_role/app_slot
  claims), deploy runbook in its README.
- `tools/bake` — v1's buildPlayerTable ported: 38 Sleeper fetches (season +
  18 weekly projections, 18 weeks prior actuals) → `apps/web/public/
  players.json` with proj/bye/SOS/PO/interest/stat-lines/VORP/tiers.
  Defaults BAKE_SEASON=2026, BAKE_PRIOR=2025 — flip to 2027/2026 when
  Sleeper publishes 2027 projections (~July 2027). Output matches v1
  production to the decimal (Gibbs 416.3 T1 +207). Also writes
  `public/actuals/<season>.json` for BOTH the prior and the current season —
  per-player real points scored week by week under IMP rules (never off a
  season total; the yardage bonuses are per-game). ~28KB a season, and it is
  what lets the Analyzer regrade an archived draft. Scoped to FANTASY weeks
  1–17 (14 regular + the 15–17 playoff window): week 18 is NFL-only and falls
  outside the season a draft was built for. The drawer's `lastSeason` stays a
  full 18-week NFL total, which is v1's number — a bake-time assert checks
  that one against the full sum and that 1–17 never exceeds it, so the two
  cannot be quietly conflated.
- `tools/archive` — publishes a finished draft as a permanent record, so the
  league's history does not depend on anyone remembering to. Reads the
  season's log from Supabase (anon), folds it, and builds the document with
  `apps/web/src/archive.ts` — the SAME module the "Archive current draft"
  button uses, so a CI-published archive and a hand-downloaded one are
  identical by construction rather than by two implementations agreeing to
  stay in step. Runs daily from `daily-data.yml` after the bake; the decision
  logic (`plan.ts`) is pure and unit-tested. Two guards do the work: it skips
  unless the draft is COMPLETE, and unless `players.json` is that same
  season's pool — once the bake rolls forward, re-deriving an old year would
  restate its grades with projections nobody drafted against, which makes an
  archive frozen the moment the pool moves on. Also idempotent: an unchanged
  board is recognised through the `archivedAt` timestamp, so the daily run
  commits nothing.
- `tools/dev-api` — local Supabase stand-in: real migration in PGlite, real
  RLS per request, real JWT crypto, SSE for realtime, `/reset` for e2e.
  Dev PINs: commish 1111, teams 2201–2211.
- `apps/web` — React 19 + Vite. **`src/styles/v1.css` is v1's stylesheet
  verbatim and components emit v1's exact DOM/class names** — that is the
  fidelity method: when a surface looks wrong, diff against v1's markup in
  `../fantasy-draft-assistant/public/{index.html,app.js}`, don't restyle
  from memory. `src/transport.ts` picks local vs hosted by env
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SEASON`). Ported v1
  logic (recommendations/needs, 💎 rule, sort tables, STAT_COLS) lives in
  `src/v1logic.ts`. The queue is `src/queue.ts` (per-browser, never
  published). PWA via vite-plugin-pwa — deliberately NO offline write
  queue: writes fail loudly (v1's lesson).

## Deployed infrastructure (all live, all verified)

- Supabase: project `fantasy-architect`, ref `prkdvoyxtdwwzeqqrzcq`,
  us-east-2, PG17. Season 2027 seeded (11 teams, league order). NOTE: its log
  holds one stray `draft_started` (seq 15, 1 Sep 2026) from a hosted test, so
  the live site shows the draft as begun. Harmless — it binds nothing, settings
  stay editable, and the first real pick would follow it — but clear it with
  the service role before draft night if you want a clean start.
  Legacy JWT secret is set as function secret FA_JWT_SECRET — dashboard-only
  to obtain; validate any copied value by HMAC-ing the legacy anon key
  before trusting it (see supabase/README).
- Frontend: https://fantasy-architect.netlify.app (site id
  45be6d85-19a5-4c78-8b03-3ab44e3f6677), deployed by GitHub Actions on push
  (`deploy.yml` — tests gate the deploy) and daily 10:00 UTC
  (`daily-data.yml` — bake, commit-if-changed, deploy itself; pushes from
  the default token don't retrigger workflows, by design).
- GitHub: shakeelvictor/fantasy-architect (private). Secrets set:
  NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID, SUPABASE_URL, SUPABASE_ANON_KEY.
  `keep-warm.yml` pings weekly so the Supabase free tier can't pause.
- Local secrets (never in the repo): `~/.config/fa2/supabase.env` (db
  password, keys, ref) and `~/.config/fa2/pins-2027.txt` (league PINs,
  commish + 11 teams). v1's launch.json has `fa2-api` / `fa2-web` /
  `fa2-web-hosted` preview configs.

## Testing

- `pnpm -r test` — scoring goldens (23) + rules/DB integration (38) +
  archive planning (7).
- `pnpm --filter @fa/web test` — two-browser Playwright e2e (draft-night
  slice + parity slice) against dev-api; kill ports 8787/5173 first
  (`lsof -ti tcp:8787 | xargs kill -9`). Keep every data-testid stable.
- Hosted smoke pattern: seed a throwaway season (9998/9999) via service
  role, drive it, DELETE the season (cascades). Never test on 2027.
- Mutation-check new golden suites — a test that can't fail proves nothing.

## Conventions & gotchas (each cost a failed run)

- pnpm version comes from `packageManager` only; CI deploy is
  `pnpm --package=netlify-cli dlx netlify deploy --prod --no-build --dir
  apps/web/dist` run from `working-directory: apps/web`.
- corepack in v1's cwd complains "configured to use yarn" — run pnpm from
  this repo's directories (launch configs use `sh -c cd`).
- SSE needs an immediate `: hello` flush + heartbeat or EventSource hangs.
- Edge function CORS must allow `apikey` header — curl never catches this,
  only a real browser.
- Supabase Realtime never replays: refill from last seq on every
  (re)subscribe (transport does this).
- Realtime requires the table in the `supabase_realtime` publication
  (migration 0002).
- `security find-generic-password -s "Supabase CLI" -w` → access token;
  Netlify token in `~/Library/Preferences/netlify/config.json`.

## v1 surface port — DONE (Sep 2026, one commit per feature)

All seven remaining v1 surfaces are ported and deployed, each with e2e:
1. **Player card/drawer** (`Drawer.tsx` + `profile.ts`) — hero/vitals/ranks,
   Summary (Sleeper outlook, clamped), Game Log (prior season re-scored via
   `@fa/scoring`), Depth (pure bake), News + wide rail. The bake now emits
   the card's fields (bio/depth/opps/weekPts/lastSeason/overallRank) plus
   top-level `sosRanks` — additive; Gibbs invariant still 416.3 T1 +206.8.
2. **Mock drafts** (`mock.ts`, `MockControls.tsx`) — a LOCAL event list
   through the SHARED reducer, mirroring submit_event (pick coords, keeper
   chaining, v1's mock undo-rewind). Keepers/trades stay real; picks never
   touch the server. Persisted per browser (`fa-mock-<season>`).
3. **Redo** (`redoablePids` in @fa/rules, unit-tested) — walk the log with a
   redo stack; redo = resubmit ONE pick_made, keepers re-chain server-side.
4. **Pick ticker** (`Ticker.tsx`) — markup memoized so re-renders never
   restart the marquee.
5. **Confirm-before-draft** (`DraftConfirm.tsx`) — guards the three HUMAN
   buttons only (pool row / top suggestion / drawer); Ask, Take-it, bots,
   redo are exempt (v1's rule).
6. **Exports/MFL** (`xlsx.ts`, `exports.ts`, `MflPanel.tsx`,
   `supabase/functions/mfl/`) — the MFL core is platform-neutral and shared
   by the edge function AND dev-api's `/mfl` (like auth-pin/jwt.ts). `setup`
   is open; `push` needs a commish JWT — see **Who may push to MFL** below. Deployed + verified vs the real 2026
   league. NOTE: the client asks MFL for VITE_SEASON's year — the 2027 MFL
   site 404s until the league renews there (check the league id then too).
7. **Archives** (`archive.ts`, `ArchiveTab.tsx`) — v1's document schema
   unchanged; v1's completed 2026 draft is committed as
   `apps/web/public/drafts/2026.json` seed history. The document now also
   pins each pick's `vorp` and each team's draft-night `draftGrade`/`draftZ`,
   so it can be re-graded years later without the bake that produced it (the
   2026 seed was backfilled once from the 2026 pool).

## Who may push to MFL

Pushing REPLACES every draft result in the league, for whatever season it is
aimed at, so it is the most destructive call the app can reach. Four
independent things have to hold, and they are layered on purpose:

1. `authorizePush()` in `supabase/functions/mfl/core.ts` is the ONE rule,
   shared by the hosted edge function and dev-api. It was hand-rolled either
   side of the wire before; two copies of a security check are two copies to
   keep in step, and the one that drifts is the one nobody notices.
2. It **fails closed on a missing signing secret**. `verifyJwt(token, '')`
   happily verifies a token signed with the empty string, so a secret that
   went missing — rotated, mistyped, a fresh project without it — would have
   turned commissioner-only into anyone-only, silently. A missing secret is
   now a 500 refusal, never a pass.
3. A malformed token is a clean 403. `verifyJwt` THROWS on junk rather than
   returning null, which used to surface as a 500 (found by the e2e).
4. The rule is on the ROLE, not the season, so 2028 needs no code change: a
   2028 commissioner passes, a 2028 team does not. Expired sessions are
   refused too — a stale tab cannot push.

MFL credentials are typed per push and never persisted anywhere: not in
localStorage (only the franchise map is), not on our servers, not in logs.
That is deliberate and worth keeping — with no stored credentials, no
automated or background push is even possible, whatever else goes wrong.
MFL's own commissioner login is the final backstop.

Tested at three levels: `packages/rules/test/mfl-auth.test.ts` (9 cases —
role, no token, forged signature, tampered payload, expiry, garbage, missing
secret; mutation-checked), `apps/web/e2e/mfl-guard.spec.ts` (the REAL dev-api
route, since exports.spec stubs the proxy, plus "a team never even sees the
button"), and a live check against the hosted function after each deploy.

## The public draft record — `/{year}`

`fantasy-architect.netlify.app/2026` — no PIN. Not a hole: the archive under
`public/drafts/` is already a world-readable static file and the anon key in
the bundle already reads every season, so the PIN gates WRITES and always did.
What the URL adds is something a manager can be handed instead of credentials.

It exists mainly for the keeper question — keepers cost the ROUND a player was
drafted in, so every off-season someone has to work that out. The search on
the page answers it in one keystroke ("Brock Bowers → pick 3.02, #24 overall,
R3"). Below that: the board, the rosters, and the Analyzer's pinned grades,
rendered by the SAME components the signed-in app uses (`ArchiveDocView`,
`GradeGrid`, `Retrospective`), so the public view cannot drift from the
private one.

Publishing a year is automatic: `daily-data.yml` writes the archive the day
after a draft completes (see `tools/archive`). The manual route still exists —
Past Drafts → Archive current draft → commit the JSON — but nothing depends on
anyone remembering it.

Reads `public/drafts/<year>.json` only — no Supabase, no player pool, ~108KB.
A year with no archive says so and lists what is archived. `App.tsx` matches
the path BEFORE any session check (`publicYear()`), Netlify's `_redirects`
already had `/* /index.html 200`, and the PWA's navigateFallback is
index.html, so the route works installed and offline-cached too. Publishing a
year is therefore just the existing ritual: Past Drafts → Archive current
draft → commit the JSON. The Past Drafts tab shows the shareable link next to
each archived season.

NOTE: 2026 is NOT in Supabase (only 2027 is, and only the stray
`draft_started`) — it was v1's draft, inherited as that committed file, which
makes it more deterministic than a log, not less.

## The Analyzer, past drafts, and the retrospective

Every grade card is clickable and opens v1's **hot take** (`blurbs.ts`) — 2-4
sentences, tone scaled to the grade, seasoned with real facts mined from that
team's picks (biggest steal vs ADP, worst reach, an early kicker, a third QB
in a 1-QB league, RB/WR hoarding, 💎 sleepers). All 98 line pools are v1's
verbatim — checked byte-for-byte against v1's app.js, because retyping is how
a port becomes a rewrite.

The rotation is the load-bearing part and the reason it isn't `Math.random()`:
teams sharing a group (same grade, both having a steal…) draw from a shared
pool at an offset derived from their position in that group, so no two get the
same sentence while the pool is deep enough — and the offset is seeded from
the pick count, so the same board always reads the same way. Testing that
needs care: every line interpolates the team name, so comparing rendered
sentences proves nothing (five teams always yield five distinct strings). The
e2e strips each team's own name and compares the SHAPE.

The modal is portalled to `document.body`. v1 put `#team-modal` at the end of
`#app`; rendering it where the grid lives instead puts it inside `.card`,
which carries a transform — and a transform makes a `position: fixed`
descendant resolve against THAT box, not the viewport. It landed 3600px down
the page until the portal went in.

`grades.ts` is the one grading implementation: VORP **per pick** (v1's rule —
grading on a total marks a team down mid-draft for simply having picked
fewer times), z-scored across the teams that have picked. v2 had drifted to
total VORP and to a `grade` class the CSS never styled; both fixed.

The Analyzer tab picks its source: the live draft, or any season in
`drafts/index.json`. An archived draft is shown with the letters pinned into
its document — the assessment as it stood that night, not what today's
formula would say.

`hindsight.ts` then regrades against `actuals/<season>.json`, and only once
the fantasy season is FINISHED (all 17 weeks). A draft grade is a claim about
a whole season, so marking it mid-season measures luck rather than the claim
— and holding that line is what lets everything else compare season totals
directly, with no proration and no hedging. Part-way through, the panel shows
"N of 17 weeks" and no grades. Each team then gets draft grade → actual grade
(same per-pick, league-relative basis, so the letters mean the same thing), a
called-it/underrated/overrated verdict from rank movement, and its best hit
and worst miss against what the board projected. SCOPE: it follows the players
a team DRAFTED for the whole season, wherever they went — points scored after
a drop or trade still count to the team that picked them, because the claim
under test is the board's valuation of those players. So a drafted squad's
rank is NOT the league standings; a GM can win off waivers on a draft that
grades badly here, and separating the two is the point. The panel says so
directly, because "actual grade F" otherwise reads as a bad season. **The 2026 season had not
kicked off as of Sep 2026**, so the panel shows the not-yet state.

Parked, not a gap — a SECOND analyzer (Shak, Sep 2026): pull each team's
final MFL roster, diff it against what they drafted, and write one
end-of-season review of the year as managed. Deliberately separate from the
retrospective above, which grades the draft and should stay that single
claim. Needs MFL transaction/roster history and is only buildable once a
season has actually been played — earliest Dec 2026 for the 2026 league.

Known gaps, deliberate: Sleepers & Busts has no trending "buzz" column yet
(the drawer's 🔥 badge is the only trending consumer); `player_moved` is
still a reducer no-op; mock redo restores a multi-pick rewind one pick at
a time.

Keep commits with explicit file lists; Shakeel edits repos himself.
