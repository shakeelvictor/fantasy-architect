// v1's pure client-side logic, ported verbatim where it matters: roster
// needs, the recommendation formula, 💎 sleepers, sort tables, stat columns.
// All of it reads the baked pool + the folded draft state — no new opinions.

import { ownerOf, roundOf, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from './api';

export const STARTERS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, IDP: 3 } as const;

export const headshot = (pid: string): string =>
  `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;

export function myNextPickOverall(config: SeasonConfig, state: DraftState, slot: number): number | null {
  const total = config.teams * config.rounds;
  for (let ov = state.picks.length + 1; ov <= total; ov++) {
    if (ownerOf(config, state, ov) === slot) return ov;
  }
  return null;
}

export function myPickAfterNext(config: SeasonConfig, state: DraftState, slot: number): number | null {
  const total = config.teams * config.rounds;
  let found = 0;
  for (let ov = state.picks.length + 1; ov <= total; ov++) {
    if (ownerOf(config, state, ov) === slot && ++found === 2) return ov;
  }
  return null;
}

export function availablePlayers(players: PoolPlayer[], state: DraftState): PoolPlayer[] {
  const gone = new Set(state.picks.map((p) => p.pid));
  const kept = new Set(state.keepers.map((k) => k.pid));
  return players.filter((p) => !gone.has(p.pid) && !kept.has(p.pid));
}

export function rosterForSlot(players: Map<string, PoolPlayer>, state: DraftState, slot: number): PoolPlayer[] {
  return state.picks.filter((p) => p.slot === slot).map((p) => players.get(p.pid)).filter((p): p is PoolPlayer => !!p);
}

export function pendingKeepersForSlot(
  players: Map<string, PoolPlayer>, state: DraftState, slot: number,
): { p: PoolPlayer; round: number }[] {
  const picked = new Set(state.picks.map((p) => p.pid));
  return state.keepers
    .filter((k) => k.slot === slot && !picked.has(k.pid))
    .map((k) => ({ p: players.get(k.pid)!, round: k.round }))
    .filter((x) => !!x.p)
    .sort((a, b) => a.round - b.round);
}

interface Needs {
  count: Record<string, number>;
  open: Record<string, number>;
  flexOpen: number;
}

export function rosterNeeds(players: Map<string, PoolPlayer>, state: DraftState, slot: number): Needs {
  const roster = rosterForSlot(players, state, slot);
  const count: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, IDP: 0 };
  for (const p of roster) count[p.group] = (count[p.group] ?? 0) + 1;
  const open: Record<string, number> = { ...STARTERS };
  const used: Record<string, number> = {};
  for (const g of ['QB', 'RB', 'WR', 'TE', 'K', 'IDP']) {
    used[g] = Math.min(count[g]!, open[g] ?? 0);
    open[g] = (open[g] ?? 0) - used[g]!;
  }
  let flexLeft: number = STARTERS.FLEX;
  for (const g of ['RB', 'WR', 'TE']) {
    const extra = count[g]! - used[g]!;
    flexLeft -= Math.min(extra, flexLeft);
  }
  return { count, open, flexOpen: flexLeft };
}

function needMultiplier(p: PoolPlayer, needs: Needs, round: number, rounds: number): number {
  const g = p.group;
  const { count, open, flexOpen } = needs;
  if (g === 'K') {
    if (round < rounds - 2) return 0.05;
    return open.K! > 0 ? 1.4 : 0.1;
  }
  if (g === 'QB') {
    if (open.QB! > 0) return 1.25;
    return count.QB! >= 2 ? 0.05 : 0.35;
  }
  if (g === 'IDP') {
    if (open.IDP! > 0) return round <= 4 ? 0.55 : 1.2;
    return count.IDP! >= 5 ? 0.1 : 0.4;
  }
  if (open[g]! > 0) return 1.25;
  if (flexOpen > 0) return 1.05;
  if (g === 'TE' && count.TE! >= 2) return 0.25;
  return g === 'TE' ? 0.5 : 0.8;
}

export interface Rec { p: PoolPlayer; atRisk: boolean }

export function recommendations(
  players: PoolPlayer[], byPid: Map<string, PoolPlayer>,
  config: SeasonConfig, state: DraftState, slot: number, topN = 8,
): Rec[] {
  const needs = rosterNeeds(byPid, state, slot);
  const total = config.teams * config.rounds;
  const round = roundOf(config, Math.min(state.picks.length + 1, total));
  const next = myNextPickOverall(config, state, slot);
  const after = myPickAfterNext(config, state, slot);
  const scored = availablePlayers(players, state).slice(0, 400).map((p) => {
    const base = Math.max(p.vorp ?? 0, 0) + Math.max(p.proj, 0) * 0.02;
    const mult = needMultiplier(p, needs, round, config.rounds);
    let urgency = 1;
    if (p.adp && after && next) {
      if (p.adp < next + 2) urgency = 1.15;
      else if (p.adp > after + 10) urgency = 0.92;
    }
    const atRisk = p.adp != null && after != null && p.adp <= after;
    return { p, score: base * mult * urgency, atRisk };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// 💎 — v1's overall-ADP rule (trending boost arrives with the news feed)
export function isSleeper(p: PoolPlayer, overallRank: number): boolean {
  if (p.adp == null || p.adp < 55) return false;
  if (overallRank > 160) return false;
  return p.adp - overallRank >= Math.max(20, p.adp * 0.3);
}

// ---- sorting + column views, straight from v1
export const SORT_DEFAULT_DIR: Record<string, 'asc' | 'desc'> = {
  rk: 'asc', proj: 'desc', adp: 'asc', bye: 'asc', sos: 'asc', po: 'asc', int: 'asc',
};

export function sortValue(p: PoolPlayer, rank: number, key: string): number | null {
  switch (key) {
    case 'rk': return rank;
    case 'proj': return p.proj;
    case 'adp': return p.adp;
    case 'bye': return p.bye;
    case 'sos': return p.sos;
    case 'po': return p.po;
    case 'int': return p.interest;
    default:
      if (key.startsWith('s:')) return p.stats?.[key.slice(2)] ?? null;
      return null;
  }
}

export const STAT_COLS: Record<string, [string, string][]> = {
  QB: [['pass_yd', 'Pass Yds'], ['pass_td', 'Pass TD'], ['pass_int', 'Int'], ['rush_yd', 'Rush Yds'], ['rush_td', 'Rush TD']],
  RB: [['rush_att', 'Carries'], ['rush_yd', 'Rush Yds'], ['rush_td', 'Rush TD'], ['rec', 'Rec'], ['rec_yd', 'Rec Yds'], ['rec_td', 'Rec TD']],
  WR: [['rec', 'Rec'], ['rec_yd', 'Rec Yds'], ['rec_td', 'Rec TD'], ['rush_yd', 'Rush Yds'], ['rush_td', 'Rush TD']],
  TE: [['rec', 'Rec'], ['rec_yd', 'Rec Yds'], ['rec_td', 'Rec TD']],
  K: [['fgm_40_49', 'FG 40-49'], ['fgm_50p', 'FG 50+'], ['xpm', 'XP']],
  IDP: [['idp_tkl_solo', 'Solo'], ['idp_tkl_ast', 'Ast'], ['idp_sack', 'Sacks'], ['idp_int', 'Int'], ['idp_ff', 'FF']],
  ALL: [['pass_yd', 'Pass Yds'], ['rush_yd', 'Rush Yds'], ['rec', 'Rec'], ['rec_yd', 'Rec Yds'], ['rec_td', 'Rec TD']],
};

export function sosClass(v: number | null): string {
  if (v == null) return '';
  if (v <= 13) return 'sos-good';
  if (v >= 21) return 'sos-bad';
  return '';
}
