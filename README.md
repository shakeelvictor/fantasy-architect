# fantasy-architect

Event-sourced rebuild of the INDOMEXPAK draft tool. Architecture proposal:
see the pinned artifact. Phase 0 = `packages/scoring`, a TypeScript port of
the v1 rules engine, golden-tested against the v1 engine's own output over
real cached Sleeper data (projections + 2025 actuals).

The v1 app (vanilla JS, `../fantasy-draft-assistant`) stays frozen and
deployable until 2.0 runs the 2027 draft.

## Status

- **Phase 0** — `packages/scoring`: TS port of the v1 rules engine; 35,866
  golden cases bit-identical to v1, mutation-checked.
- **Phase 1** — `supabase/`: event-log schema, every league rule as a
  BEFORE INSERT trigger, RLS (a team token can only ask for its own slot),
  `submit_event` RPC with keeper chaining + undo cascade; `packages/rules`
  reducer cross-checked against the SQL fold; auth-pin edge function.
- **Phase 2** — `apps/web` + `tools/dev-api`: the vertical slice. React 19 +
  Vite, CSS Modules on design tokens, virtualized pool, live board, PIN
  gate, Take-it/Reject flow — realtime over SSE against the real migration
  in PGlite. Two-browser Playwright e2e: commissioner→team propagation
  measured at ~26ms; offline pick fails loudly and leaves no residue.

Run it: `pnpm --filter @fa/dev-api start` + `pnpm --filter @fa/web dev`,
then http://localhost:5173 — commish PIN 1111, team PINs 2201–2211.
