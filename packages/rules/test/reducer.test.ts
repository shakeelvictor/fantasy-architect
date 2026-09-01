// Pure-reducer unit tests (no database) for helpers the UI leans on.
import { describe, expect, it } from 'vitest';
import {
  applyEvent, foldEvents, initialState, ownedPickCounts, rosterBalance,
  type DraftEvent, type SeasonConfig,
} from '../src/index.ts';

const CFG: SeasonConfig = { teams: 3, rounds: 4, type: 'linear' };
const ev = (seq: number, type: DraftEvent['type'], payload: Record<string, unknown>): DraftEvent =>
  ({ seq, type, payload });

describe('roster balance', () => {
  it('an untraded draft is balanced', () => {
    const b = rosterBalance(CFG, initialState());
    expect(b.balanced).toBe(true);
    expect(ownedPickCounts(CFG, initialState())).toEqual([4, 4, 4]);
  });

  it('a one-sided trade unbalances; the matching side restores', () => {
    let st = initialState();
    st = applyEvent(st, ev(1, 'pick_traded', { round: 2, from_slot: 1, to_slot: 3 }));
    const uneven = rosterBalance(CFG, st);
    expect(uneven.balanced).toBe(false);
    expect(uneven.offenders).toEqual([
      { slot: 1, owns: 3 },
      { slot: 3, owns: 5 },
    ]);
    st = applyEvent(st, ev(2, 'pick_traded', { round: 3, from_slot: 3, to_slot: 1 }));
    expect(rosterBalance(CFG, st).balanced).toBe(true);
  });

  it('a reverted trade restores balance too', () => {
    const st = foldEvents([
      ev(1, 'pick_traded', { round: 2, from_slot: 1, to_slot: 3 }),
      ev(2, 'trade_reverted', { round: 2, from_slot: 1 }),
    ]);
    expect(rosterBalance(CFG, st).balanced).toBe(true);
  });
});
