// The rules that decide whether a season gets published, and the one that
// stops it being republished wrong a year later.

import { describe, expect, it } from 'vitest';
import type { DraftEvent, SeasonConfig } from '@fa/rules';
import { planArchive, withSeason, type Pool } from '../src/plan.ts';
import type { ArchiveDoc } from '../../../apps/web/src/archive.ts';

const CONFIG: SeasonConfig = { teams: 2, rounds: 2, type: 'linear', order: ['A', 'B'] };

const pool = (season: string): Pool => ({
  season,
  players: [1, 2, 3, 4].map((n) => ({
    pid: `p${n}`, name: `Player ${n}`, pos: 'RB', group: 'RB', team: 'CHI',
    proj: 100 * n, adp: n, bye: 7, sos: null, po: null, interest: null,
    injury: null, stats: null, posRank: n, vorp: 10 * n, tier: 1,
  })),
});

const pick = (seq: number, pid: string, overall: number, slot: number): DraftEvent => ({
  seq, type: 'pick_made',
  payload: { pid, overall, round: overall <= 2 ? 1 : 2, slot, is_keeper: false },
});
const FULL = [
  { seq: 1, type: 'draft_started' as const, payload: {} },
  pick(2, 'p1', 1, 1), pick(3, 'p2', 2, 2), pick(4, 'p3', 3, 1), pick(5, 'p4', 4, 2),
];

const plan = (o: Partial<Parameters<typeof planArchive>[0]> = {}) => planArchive({
  season: 2027, config: CONFIG, events: FULL, pool: pool('2027'), existing: null, ...o,
});

describe('what gets archived', () => {
  it('publishes a completed draft', () => {
    const p = plan();
    expect(p.action).toBe('write');
    if (p.action !== 'write') return;
    expect(p.doc.picks).toHaveLength(4);
    expect(p.doc.complete).toBe(true);
    expect(p.doc.teams.map((t) => t.name)).toEqual(['A', 'B']);
    // the grade the night produced is pinned in, ready to be marked later
    expect(p.doc.teams.every((t) => t.draftGrade)).toBe(true);
  });

  it('leaves a draft in progress alone', () => {
    const p = plan({ events: FULL.slice(0, 3) });
    expect(p).toMatchObject({ action: 'skip' });
    expect(p.reason).toMatch(/2 of 4 picks/);
  });

  it('is idempotent — an unchanged board is not rewritten', () => {
    const first = plan();
    if (first.action !== 'write') throw new Error('expected a write');
    // a day later, same log: the only difference would be the timestamp
    expect(plan({ existing: first.doc })).toMatchObject({
      action: 'skip', reason: 'already archived, unchanged',
    });
  });

  it('republishes when the board actually changed', () => {
    const first = plan();
    if (first.action !== 'write') throw new Error('expected a write');
    const undone = [...FULL, { seq: 6, type: 'pick_undone' as const, payload: { overall: 4 } },
      pick(7, 'p4', 4, 2)];
    const again = plan({ events: undone, existing: { ...first.doc, picks: [] } as ArchiveDoc });
    expect(again.action).toBe('write');
  });

  // The guard that matters most, because it fails silently otherwise: once
  // the bake rolls forward, players.json holds a different season's
  // projections and VORP. Re-deriving an old archive from it would restate
  // that year's grades with numbers nobody drafted against.
  it('refuses to rebuild a season from a different season\'s pool', () => {
    const p = plan({ pool: pool('2028') });
    expect(p).toMatchObject({ action: 'skip' });
    expect(p.reason).toMatch(/2028 pool/);
  });
});

describe('the index', () => {
  it('adds a season newest-first and leaves existing entries alone', () => {
    const before = [{ season: 2026, file: '2026.json', label: '2026' }];
    expect(withSeason(before, 2027)).toEqual([
      { season: 2027, file: '2027.json', label: '2027' },
      { season: 2026, file: '2026.json', label: '2026' },
    ]);
  });

  it('does not duplicate a season already listed', () => {
    const twice = withSeason(withSeason([], 2027), 2027);
    expect(twice).toHaveLength(1);
  });
});
