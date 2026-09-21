# CLAUDE.md — fantasy-architect (v2)

The ground-up rebuild of the INDOMEXPAK draft tool. Owner: Shakeel ("Shak",
league slot 11). The v1 app, `../fantasy-draft-assistant`, ran the completed
2026 draft and is retired — archived (read-only) on GitHub. This repo is the
only one maintained; v2 runs the 2027 draft onward. The league rules below
were carried over from v1's CLAUDE.md so nothing here depends on it.

## League facts (canonical)

- **11 teams, 20 rounds, STRAIGHT draft** (same order every round — never
  snake; the league has a moratorium on even discussing snake until 2027).
- 2026 draft order: Anand, Vip, Andres, Ryaan, Dante, Hoss, Asher, Imran,
  Samson, Laura, **Shak (slot 11)**. Season 2027 is seeded in the same order.
- Rosters: QB, 2 RB, 3 WR (a TE may fill one), TE, FLEX (no QB), K, 3 IDP,
  8 BN. Max 2 keepers. Fantasy regular season = weeks 1–14, playoffs =
  **weeks 15–17** (week 18 is "Pakistan vs. the World").
- **Every team finishes the draft with exactly 20 players — never 19 or 21.**
  Trades must be pick-for-pick even; each side gives and gets the same number.
  Entering one side at a time is briefly uneven and that's fine — `rosterBalance`
  flags it rather than blocking — but always **enter both sides**.
- **The 3 IDP slots take ANY defensive player in any combination** — no
  DL/LB/DB requirement. Every defender carries `posGroup: 'IDP'` and
  replacement level is computed over one combined IDP pool; DL/LB/DB labels
  are display only.
- In the Notion keeper tables, **"Austin" is Hoss** (older seasons use the
  former name).
- **Scoring source of truth: https://fflr.netlify.app/rules#scoring** (data
  in `rules-data.js` on that site) — NOT Sleeper's league settings, which
  can only approximate the rules. Key quirks: 0.04/pass yd with 300/325/350
  per-game bonus tiers, **0.13333/rush yd** with 100/125/150 tiers, half-PPR
  with 125/150/175 tiers, distance-banded kicking (6 pts for 60+), IDP solo
  tackle escalator (7.5 pts at 7 solos, 12.5 at 10), 6-pt pass TDs.
  `packages/scoring` implements all of it.
- Sleeper league 1389392616327503872 (draft 1389392616327503873) was the 2026
  draft room; it runs with a **fake 12th team** (Sleeper needs an even count).
- MFL league **19716** (www44.myfantasyleague.com, "INDOMEXPAK 2026") is the
  season-management site (`MFL_LEAGUE_ID` in `supabase/functions/mfl/core.ts`).
  Franchise↔owner map (in `MflPanel.tsx`): 0001=Shak, 0002=Ryaan,
  0003=Samson, 0004=Imran, 0005=Hoss, 0006=Andres, 0007=Asher, 0008=Dante,
  0009=Vip, 0010=Anand, 0011=Laura.
  **Never key anything on the team name.** Managers rename teams freely, but
  franchise ids are permanent, so a rename needs no code change. To re-check:
  `curl -s "https://www44.myfantasyleague.com/2026/export?TYPE=league&L=19716&JSON=1"`

## The one architectural idea

Every draft mutation is an immutable row in Postgres (`draft_events`,
Supabase). State = a fold over the log. Every browser folds the same log via
the shared reducer (`@fa/rules`), so every device renders the same board —
the v1 failure class where an empty Safari overwrote a finished draft is
unrepresentable. League rules are a BEFORE INSERT trigger (`fa_validate` in
`supabase/migrations/0001_foundation.sql`); the `submit_event()` RPC adds
idempotency keys, keeper auto-fill chaining, and the undo cascade. RLS: a
team JWT can express exactly two writes — `pick_made` when its OWN slot is on
the clock, and `pick_requested` for its own slot; spectators read everything
with the anon key; the log is append-only for everyone (corrections are
compensating events).

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
  stay in step. Runs weekly from `daily-data.yml` after the bake; the decision
  logic (`plan.ts`) is pure and unit-tested. Two guards do the work: it skips
  unless the draft is COMPLETE, and unless `players.json` is that same
  season's pool — once the bake rolls forward, re-deriving an old year would
  restate its grades with projections nobody drafted against, which makes an
  archive frozen the moment the pool moves on. Also idempotent: an unchanged
  board is recognised through the `archivedAt` timestamp, so the weekly run
  commits nothing.
- `tools/dev-api` — local Supabase stand-in: real migration in PGlite, real
  RLS per request, real JWT crypto, SSE for realtime, `/reset` for e2e.
  Dev PINs: commish 1111, teams 2201–2211.
- `apps/web` — React 19 + Vite. **`src/styles/v1.css` is v1's stylesheet
  verbatim and components emit v1's exact DOM/class names** — that is the
  fidelity method: when a surface looks wrong, diff against v1's markup in
  `../fantasy-draft-assistant/public/{index.html,app.js}` (the archived v1
  repo — still clonable read-only), don't restyle from memory. `src/transport.ts` picks local vs hosted by env
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
  (`deploy.yml` — tests gate the deploy) and weekly, Tuesdays 10:00 UTC
  (`daily-data.yml` — bake, commit-if-changed, deploy itself; pushes from
  the default token don't retrigger workflows, by design).
- GitHub: shakeelvictor/fantasy-architect (private). Secrets set:
  NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID, SUPABASE_URL, SUPABASE_ANON_KEY.
  `keep-warm.yml` pings weekly so the Supabase free tier can't pause.
- Local secrets (never in the repo): `~/.config/fa2/supabase.env` (db
  password, keys, ref) and `~/.config/fa2/pins-2027.txt` (league PINs,
  commish + 11 teams). `.claude/launch.json` has `fa2-api` / `fa2-web` /
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
- corepack complains "configured to use yarn" if pnpm runs from v1's
  directory — run pnpm from this repo's directories (launch configs `cd` in).
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

## Teams draft for themselves (migration 0006)

A team drafts its own pick when its own slot is on the clock. Before this the
commissioner had to convert every request into a pick, which made them a
bottleneck on the whole night — step away, sign out, or miss the banner and
the board stopped for everyone.

The safety rests on something already true rather than on new checks:
`fa_validate` has ALWAYS required a `pick_made`'s `slot` to equal
`fa_owner_of()` and its `overall` to equal the next pick, for every author
including the commissioner. So a pick out of turn, for another team, or for a
player already gone is unrepresentable whoever sends it, and the only question
left for RLS is whose turn it is — one comparison. The two layers compose into
"a team may draft when, and only when, it is their turn" without either
knowing the whole rule.

`pick_requested` keeps its job and gets a sharper one: it is now specifically
the OFF-the-clock move, a pre-pick the commissioner can take once that team
comes up (`submit_event` only accepts a request whose slot is on the clock).
The UI follows exactly: on the clock a team sees Draft, off it, Ask.

Unchanged for teams: undo, redo, trades, keepers, starting or completing the
draft, resolving any request (including their own), and any pick for another
slot. All seven are asserted in `db.integration.test.ts`.

## Signing out mid-draft

The ⏻ asks before signing out, but ONLY while a draft is live (started, not
complete) — a prompt on a dead board is noise, and noise is how prompts stop
being read. The wording says what is actually at stake, because a sign-out
prompt must not read as a warning about losing the draft.

Nothing IS at stake. Sign-out removes one localStorage key (`fa2-session`)
and shows the Gate. The board is the server's log, so it cannot be touched
from a client at all; the queue, the mock, the MFL franchise map and the
theme all live under their own keys and survive. The only real cost is the
minute of getting back in — and for the commissioner, that nobody can make
picks while they are out (teams can still ask). `signout.spec.ts` drives both
roles through it mid-draft and checks the board, the queue and the event log
come back identical.

Sign-out now also calls `disconnect()`. It never did: the stream stayed open
behind the PIN screen, holding a Realtime connection on a tier that counts
them, and `connect()` would early-return on the next login believing it was
still connected.

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

Publishing a year is automatic: `daily-data.yml` writes the archive on its
first weekly run after a draft completes (see `tools/archive`) — dispatch it
by hand the morning after draft night to publish at once. The manual route still exists —
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

**2025** was imported from `Fantasy_Draft_2025.xlsx` (Sep 2026): 220 picks,
11 teams, straight, 15 keepers, every player resolved to a Sleeper id and
cross-checked against `actuals/2025.json`. It carries NO projections — the
2025 board's numbers are gone — so `hasProjections(doc)` is false for it and
both the Analyzer and `/2025` leave the grade grid and the retrospective out
rather than grading against zeros and printing eleven identical Cs. Anything
imported after the fact should follow that rule. Its `source` field records
the provenance. One oddity in the source data, left as-is because it is the
league's record and not mine to correct: Dante shows 3 keepers where the rule
is max 2.

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

## Motion: native, no library

Evaluated Framer Motion / GSAP (Sep 2026) and did not take either. The app
was already heavily animated — v1.css carries 36 `@keyframes`, 50 animation
rules and 8 `prefers-reduced-motion` blocks — so the gaps were never "add
animation", they were the few v2-authored surfaces that still snapped. GSAP's
timelines duplicate what v1.css already does well; Motion's `layout` is the
one thing genuinely hard to hand-roll, and it costs 18–34KB gz against a
~104KB gz bundle for flare on a draft-night phone.

`@starting-style` does the enter animation for the panels and the Gate with
**+110 bytes of CSS and +20 bytes of JS**, measured. Two rules to keep:
animate ONLY `opacity` and `transform` (compositor-only — a width or top
costs a layout pass per frame), and mirror v1's reduced-motion discipline.
Exit is deliberately instant: React unmounts these, so an exit transition
means keeping them mounted with their state and effects alive (MflPanel
fetches on mount) for the least-noticed half of the motion.

`motion.spec.ts` guards it, and the guard needs care — asserting the settled
state proves nothing, because deleting the `@starting-style` just makes the
panel appear at its end state and every after-the-fact check still passes.
It asserts the rule exists in the CSSOM, scoped to that panel's own hashed
class (a global scan silently matches the Gate's instead).

`styles/native-motion.css` holds everything that enhances a v1 class —
ADDITIVE only, loaded after v1.css, which stays verbatim. Delete the sheet
and the app looks and behaves exactly as before, minus the movement; that is
also the fallback on a browser without these features, which is why none of
it is wrapped in `@supports`. Two more landed there:

- **The pool re-sorting** cross-fades via the View Transitions API
  (`viewTransition.ts`, ~10 lines, guarded for support and reduced motion).
  ONE `view-transition-name` on the wrapper, not one per row: per-row names
  give true FLIP but cost a snapshot each across 250 rows, and that is the
  version where a library would earn its weight.
- **The news rail's bottom veil** is now a scroll-driven animation. The rail
  publishes a named timeline, the veil borrows it through `timeline-scope`,
  and `watchRailEnd`'s scroll listener + ResizeObserver + two refs are gone.

Together with the panels: **+120 bytes of CSS, −60 bytes of JS**, net
smaller, versus 18–34KB for a library.

NOT done, deliberately: the drawer's close (`animationend` + a 400ms backstop
timer). Native exit needs the element to stay mounted for `allow-discrete` to
transition `display`, which for the drawer means restructuring per-pid
fetching and keeping the previous player's content rendered through the
exit — not a light change to the most-used component on draft night. The
timer is also not a wart: a backgrounded tab never fires `animationend`, so
something must always fire. Left alone on purpose.

Known gaps, deliberate: Sleepers & Busts has no trending "buzz" column yet
(the drawer's 🔥 badge is the only trending consumer); `player_moved` is
still a reducer no-op; mock redo restores a multi-pick rewind one pick at
a time.

Keep commits with explicit file lists; Shakeel edits repos himself.
