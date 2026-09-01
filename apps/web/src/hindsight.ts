// The retrospective: did draft night's grades turn out to be right?
//
// An archived draft carries the assessment as it stood — each team's grade and
// the per-player projections behind it. This checks that assessment against
// what the players actually scored, from the season's actuals file the daily
// bake writes (`/actuals/<season>.json`, scored week by week under IMP rules,
// never off a season total — the yardage bonuses are per-game).
//
// Two rules keep the comparison fair while a season is still being played:
//
//  1. Both grades are LEAGUE-RELATIVE z-scores, so a half-played season is
//     noisier but not biased — every team has played the same weeks.
//  2. Player hits and misses compare PER-GAME rates, never season totals. A
//     projection is for a full season; through week 4 it would call everyone
//     a bust.
//
// A team's actual grade is graded on the same per-pick basis as draft night,
// so the two letters mean the same thing and can be put side by side.

import { computeGrades, letterGrade, zScores } from './grades';
import type { ArchiveDoc } from './archive';

export interface Actuals {
  season: string;
  throughWeek: number;
  players: Record<string, [number, number]>; // pid -> [points, games]
}

const cache: Record<string, Promise<Actuals | null>> = {};

export function fetchActuals(season: number | string): Promise<Actuals | null> {
  const key = String(season);
  cache[key] ??= fetch(`/actuals/${key}.json`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<Actuals>) : null))
    .catch(() => null);
  return cache[key]!;
}

export interface PlayerVerdict {
  pid: string;
  name: string;
  pos: string;
  round: number;
  overall: number;
  projPerGame: number;
  actualPerGame: number;
  actualPts: number;
  games: number;
  delta: number; // per-game points above/below what was projected
}

export interface TeamRetro {
  slot: number;
  name: string;
  draftGrade: string;
  actualGrade: string;
  projRank: number;
  actualRank: number;
  rankDelta: number; // + = finished better than draft night said
  verdict: 'called it' | 'underrated' | 'overrated';
  actualPts: number;
  projPts: number;
  scored: number; // players with any actual data
  bestHit: PlayerVerdict | null;
  worstMiss: PlayerVerdict | null;
}

export interface Retro {
  throughWeek: number;
  complete: boolean;
  teams: TeamRetro[];
  withinOne: number; // teams whose actual finish was within one place
  meanRankError: number;
}

const RANK_TOLERANCE = 2; // places of movement before a grade was actually wrong

/** Rank a value list high-to-low, 1-based, ties sharing the better rank. */
function rankDesc(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const out = new Array<number>(values.length).fill(0);
  order.forEach((e, idx) => {
    const tieWith = idx > 0 && order[idx - 1]!.v === e.v ? out[order[idx - 1]!.i]! : idx + 1;
    out[e.i] = tieWith;
  });
  return out;
}

export function buildRetro(doc: ArchiveDoc, actuals: Actuals): Retro | null {
  if (!actuals.throughWeek) return null;
  const weeks = actuals.throughWeek;

  // Draft-night grades: prefer the ones pinned into the document, so the
  // retrospective judges what was actually SAID at the time rather than what
  // today's formula would say. Fall back to recomputing for older archives.
  const fallback = computeGrades(doc.teams.map((t) => ({
    slot: t.slot,
    name: t.name,
    roster: t.roster.map((r) => ({ proj: r.proj ?? 0, vorp: r.vorp ?? 0 })),
  })));
  const draftGradeOf = (slot: number): string =>
    doc.teams.find((t) => t.slot === slot)?.draftGrade
      ?? fallback.find((t) => t.slot === slot)?.grade
      ?? '—';

  const perTeam = doc.teams.map((t) => {
    const players: PlayerVerdict[] = [];
    let actualPts = 0;
    let scored = 0;
    for (const r of t.roster) {
      const hit = actuals.players[r.pid];
      const pts = hit ? hit[0] : 0;
      const games = hit ? hit[1] : 0;
      if (hit) scored++;
      actualPts += pts;
      // a projection is a SEASON number; compare rates, not totals, or a
      // part-played season calls every pick a bust
      const projPerGame = (r.proj ?? 0) / 17;
      const actualPerGame = games ? pts / games : 0;
      players.push({
        pid: r.pid, name: r.name, pos: r.pos, round: r.round, overall: r.overall,
        projPerGame, actualPerGame, actualPts, games,
        delta: actualPerGame - projPerGame,
      });
    }
    // only judge players the board actually expected something from — a
    // 20th-round flier beating a ~0 projection is not the story
    const judged = players.filter((p) => p.projPerGame >= 3);
    const sorted = [...judged].sort((a, b) => b.delta - a.delta);
    return {
      slot: t.slot,
      name: t.name,
      projPts: t.projectedPoints ?? t.roster.reduce((a, r) => a + (r.proj ?? 0), 0),
      actualPts: Math.round(actualPts * 10) / 10,
      scored,
      perPickActual: t.roster.length ? actualPts / t.roster.length : 0,
      bestHit: sorted[0] ?? null,
      worstMiss: sorted.length > 1 ? sorted[sorted.length - 1]! : null,
      players,
    };
  });

  // The actual grade is per-pick and league-relative, exactly as draft night's
  // was, so the two letters are directly comparable.
  const actualZ = zScores(perTeam.map((t) => t.perPickActual));
  const projRanks = rankDesc(perTeam.map((t) => t.projPts));
  const actualRanks = rankDesc(perTeam.map((t) => t.actualPts));

  const teams: TeamRetro[] = perTeam.map((t, i) => {
    const rankDelta = projRanks[i]! - actualRanks[i]!; // + = finished better
    return {
      slot: t.slot,
      name: t.name,
      draftGrade: draftGradeOf(t.slot),
      actualGrade: t.scored ? letterGrade(actualZ[i]!) : '—',
      projRank: projRanks[i]!,
      actualRank: actualRanks[i]!,
      rankDelta,
      verdict: Math.abs(rankDelta) < RANK_TOLERANCE
        ? 'called it'
        : rankDelta > 0 ? 'underrated' : 'overrated',
      actualPts: t.actualPts,
      projPts: Math.round(t.projPts),
      scored: t.scored,
      bestHit: t.bestHit,
      worstMiss: t.worstMiss,
    };
  });

  const errors = teams.map((t) => Math.abs(t.projRank - t.actualRank));
  return {
    throughWeek: weeks,
    complete: weeks >= 18,
    teams,
    withinOne: errors.filter((e) => e <= 1).length,
    meanRankError: errors.length
      ? Math.round((errors.reduce((a, b) => a + b, 0) / errors.length) * 10) / 10
      : 0,
  };
}
