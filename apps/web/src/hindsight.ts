// The retrospective: did draft night's grades turn out to be right?
//
// An archived draft carries the assessment as it stood — each team's grade and
// the per-player projections behind it. This checks that assessment against
// what the players actually scored, from the season's actuals file the daily
// bake writes (`/actuals/<season>.json`, scored week by week under IMP rules,
// never off a season total — the yardage bonuses are per-game).
//
// It only runs once the fantasy season is OVER — weeks 1-17 for this league,
// the 14-week regular season plus a 15-17 playoff window. A draft grade is a
// season-long claim, so marking it through week 4 measures variance rather
// than the claim, and week 18 falls outside the season the draft was built
// for. That single rule is what lets everything else compare season totals
// directly, with no proration and no hedging.
//
// A team's actual grade is graded on the same per-pick, league-relative basis
// as draft night, so the two letters mean the same thing side by side.

import { computeGrades, letterGrade, zScores } from './grades';
import type { ArchiveDoc } from './archive';

export interface Actuals {
  season: string;
  throughWeek: number;   // fantasy weeks played so far
  seasonWeeks?: number;  // how many the fantasy season has (17 here)
  complete?: boolean;
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
  proj: number;
  actualPts: number;
  games: number;
  delta: number; // season points above/below what the board projected
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
  seasonWeeks: number;
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

/** The season's grades, or null while it is still being played. */
export function buildRetro(doc: ArchiveDoc, actuals: Actuals): Retro | null {
  const seasonWeeks = actuals.seasonWeeks ?? 17;
  const done = actuals.complete ?? actuals.throughWeek >= seasonWeeks;
  if (!done) return null;

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
      // the season is over, so this is the honest comparison: the board said
      // he would score this much, and he scored that much. Games missed are
      // part of the miss — availability is production in fantasy.
      const proj = r.proj ?? 0;
      players.push({
        pid: r.pid, name: r.name, pos: r.pos, round: r.round, overall: r.overall,
        proj, actualPts: pts, games,
        delta: pts - proj,
      });
    }
    // only judge players the board actually expected something from — a
    // 20th-round flier beating a ~0 projection is not the story
    const judged = players.filter((p) => p.proj >= 50);
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
    seasonWeeks,
    teams,
    withinOne: errors.filter((e) => e <= 1).length,
    meanRankError: errors.length
      ? Math.round((errors.reduce((a, b) => a + b, 0) / errors.length) * 10) / 10
      : 0,
  };
}
