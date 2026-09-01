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
- `supabase/` — migrations (0001 foundation, 0002 realtime publication),
  `auth-pin` edge function (PIN → 24h HS256 JWT with app_role/app_slot
  claims), deploy runbook in its README.
- `tools/bake` — v1's buildPlayerTable ported: 38 Sleeper fetches (season +
  18 weekly projections, 18 weeks prior actuals) → `apps/web/public/
  players.json` with proj/bye/SOS/PO/interest/stat-lines/VORP/tiers.
  Defaults BAKE_SEASON=2026, BAKE_PRIOR=2025 — flip to 2027/2026 when
  Sleeper publishes 2027 projections (~July 2027). Output matches v1
  production to the decimal (Gibbs 416.3 T1 +207).
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
  us-east-2, PG17. Season 2027 seeded (11 teams, league order, zero events).
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

- `pnpm -r test` — scoring goldens (23) + rules/DB integration (26).
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

## Next up (owner-confirmed order of interest)

Port the remaining v1 surfaces, using v1's source as the spec:
1. **Player card/drawer** — v1 `openDrawer()`: bio strip, Sleeper outlook/
   news (open-CORS graphql), 2025 game log scored client-side via
   `@fa/scoring` `scoreWeek(stats, true)`, depth tab. Row/board/rec clicks
   already pass pid (`onOpen` prop on Pool is wired but unused).
2. **Mock drafts** — client-side only: bot picks through the SHARED reducer
   (`foldEvents` over a local event list), never touching the server. v1's
   bot logic in `botPick()`. Manual/Mock switch is in the topbar, disabled.
3. **Redo** — compensating-event pair; needs a small design (an undone
   pick's events are still in the log — redo = resubmit pick_made).
4. **Pick ticker** — v1 `renderTicker()`, marquee under the header.
5. **Confirm-before-draft** — v1's confirm card (`pendingDraftConfirm`).
6. **Exports/MFL push** — port `public/xlsx.js` + `lib/mfl.js`; MFL login
   must proxy through a Supabase edge function (no CORS on MFL; XML=1 in
   query string ONLY — see v1 CLAUDE.md). Buttons stubbed in SidePanel.
7. **Archives** — a fold over the completed log + the Past Drafts tab; v1's
   2026 archive could be imported as seed content.

Keep commits with explicit file lists; Shakeel edits repos himself.
