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

import { redoablePids } from '../src/index.ts';

describe('redoablePids', () => {
  const pick = (seq: number, pid: string, overall: number, keeper = false): DraftEvent =>
    ev(seq, 'pick_made', { pid, overall, round: 1, slot: overall, is_keeper: keeper });
  const undo = (seq: number, overall: number): DraftEvent => ev(seq, 'pick_undone', { overall });

  it('an undone pick becomes redoable; resubmitting it pops the stack', () => {
    expect(redoablePids([pick(1, 'a', 1), undo(2, 1)])).toEqual(['a']);
    expect(redoablePids([pick(1, 'a', 1), undo(2, 1), pick(3, 'a', 1)])).toEqual([]);
  });

  it('stacked undos redo most-recent-first (lowest overall on top)', () => {
    const events = [pick(1, 'a', 1), pick(2, 'b', 2), undo(3, 2), undo(4, 1)];
    // resubmit from the END: 'a' (pick #1) first, then 'b'
    expect(redoablePids(events)).toEqual(['b', 'a']);
    expect(redoablePids([...events, pick(5, 'a', 1)])).toEqual(['b']);
  });

  it('the undo cascade strips keeper fills without making them redoable', () => {
    // real pick at 1, keeper auto-filled at 2; the undo cascade pops both
    const events = [pick(1, 'a', 1), pick(2, 'k', 2, true), undo(3, 2), undo(4, 1)];
    expect(redoablePids(events)).toEqual(['a']);
    // the redo resubmits 'a'; the keeper re-chains as a fresh derived fill
    expect(redoablePids([...events, pick(5, 'a', 1), pick(6, 'k', 2, true)])).toEqual([]);
  });

  it('a different pick after an undo takes the slot and kills the redo', () => {
    expect(redoablePids([pick(1, 'a', 1), undo(2, 1), pick(3, 'b', 1)])).toEqual([]);
  });
});
