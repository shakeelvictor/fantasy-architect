# Fantasy Architect 2.0

Event-sourced rebuild of the INDOMEXPAK draft tool. Architecture proposal:
see the pinned artifact. Phase 0 = `packages/scoring`, a TypeScript port of
the v1 rules engine, golden-tested against the v1 engine's own output over
real cached Sleeper data (projections + 2025 actuals).

The v1 app (vanilla JS, `../fantasy-draft-assistant`) stays frozen and
deployable until 2.0 runs the 2027 draft.
