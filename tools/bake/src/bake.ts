// The daily data bake — v1's buildPlayerTable, ported. Fetches Sleeper
// directly (player meta, season + 18 weekly projections, 18 weeks of
// prior-season actuals) and computes exactly what v1 computed:
//
//   proj        sum of weekly custom points (weekly rows when Sleeper has
//               them; season-line spread over the team's real schedule for
//               the deep pool — divided by gp BEFORE scoring, per-game tiers)
//   bye         the week where (nearly) all of a team's rows lose opponents
//   sos / po    avg opponent rank in custom points ALLOWED to the position,
//               from 2026's actual stat lines (1 = softest, 32 = stingiest);
//               po = the fantasy playoff window, weeks 15–17
//   interest    Sleeper's search_rank — a popularity RANK, never a roster %
//   stats       the projected stat line ('26 projections column view);
//               kickers keep the 40+ bands — Sleeper has NO total FGM
//   vorp/tier   replacement-scaled value + adaptive-gap tiers, board order
//
// pnpm --filter @fa/bake bake   (env: BAKE_SEASON, BAKE_PRIOR, BAKE_TEAMS)

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreWeek } from '@fa/scoring';

const SEASON = process.env.BAKE_SEASON ?? '2026';
const PRIOR = process.env.BAKE_PRIOR ?? '2025';
const TEAMS = Number(process.env.BAKE_TEAMS ?? 11);
const WEEKS = 18;

const OFF_POS = ['QB', 'RB', 'WR', 'TE', 'K'];
const REQUEST_POS = [...OFF_POS, 'DL', 'LB', 'DB'];
const IDP_SPECIFIC = new Set(['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'SS', 'FS']);
const GROUPS = [...OFF_POS, 'IDP'];

function normalizePos(pos: string | undefined): string | null {
  if (!pos) return null;
  if (OFF_POS.includes(pos)) return pos;
  if (IDP_SPECIFIC.has(pos)) return pos; // keep the specific position; group below
  return null; // OL / LS / P stay out of the pool
}
const groupOf = (pos: string): string => (OFF_POS.includes(pos) ? pos : 'IDP');

function replacementRank(g: string): number {
  switch (g) {
    case 'QB': return Math.round(TEAMS * 1.2);
    case 'RB': return Math.round(TEAMS * 2.4);
    case 'WR': return Math.round(TEAMS * 3.4);
    case 'TE': return Math.round(TEAMS * 1.2);
    case 'K': return TEAMS + 1;
    case 'IDP': return Math.round(TEAMS * 3.3);
    default: return TEAMS * 2;
  }
}

type Stats = Record<string, number>;
interface Row {
  player_id: string;
  team?: string | null;
  opponent?: string | null;
  player?: { first_name?: string; last_name?: string; position?: string; team?: string; injury_status?: string };
  stats?: Stats;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json() as Promise<T>;
}
const posParams = REQUEST_POS.map((p) => `position[]=${p}`).join('&');
const weekUrl = (w: number): string =>
  `https://api.sleeper.app/projections/nfl/${SEASON}/${w}?season_type=regular&${posParams}`;
const priorUrl = (w: number): string =>
  `https://api.sleeper.app/stats/nfl/${PRIOR}/${w}?season_type=regular&${posParams}`;

console.log(`baking season ${SEASON} (prior ${PRIOR})…`);
const [meta, seasonProj] = await Promise.all([
  fetchJson<Record<string, { first_name?: string; last_name?: string; position?: string; team?: string; search_rank?: number; injury_status?: string }>>(
    'https://api.sleeper.app/v1/players/nfl',
  ),
  fetchJson<Row[]>(
    `https://api.sleeper.app/projections/nfl/${SEASON}?season_type=regular&${posParams}&order_by=adp_idp_1qb`,
  ),
]);

// ---- SOS: custom points allowed by each defense per position group (prior season)
const allowed: Record<string, Record<string, number>> = {};
const defGames: Record<string, number> = {};
for (let w = 1; w <= WEEKS; w++) {
  let rows: Row[];
  try {
    rows = await fetchJson<Row[]>(priorUrl(w));
  } catch {
    continue;
  }
  const seenOpp: Record<string, boolean> = {};
  for (const row of rows) {
    const opp = row.opponent;
    const pos = normalizePos(row.player?.position);
    if (!opp || !pos) continue;
    const g = groupOf(pos);
    const pts = scoreWeek(row.stats ?? {}, true); // finished games — exact tiers
    allowed[opp] = allowed[opp] ?? {};
    allowed[opp][g] = (allowed[opp][g] ?? 0) + pts;
    seenOpp[opp] = true;
  }
  for (const t of Object.keys(seenOpp)) defGames[t] = (defGames[t] ?? 0) + 1;
}
const sosRanks: Record<string, Record<string, number>> = {};
{
  const teams = Object.keys(allowed);
  for (const g of GROUPS) {
    const sorted = [...teams].sort(
      (a, b) => (allowed[b]![g] ?? 0) / (defGames[b] ?? 1) - (allowed[a]![g] ?? 0) / (defGames[a] ?? 1),
    );
    sorted.forEach((team, i) => {
      sosRanks[team] = sosRanks[team] ?? {};
      sosRanks[team]![g] = i + 1; // 1 = allows the most = softest
    });
  }
}

// ---- weekly projections: per-player weekly points + opponents; team schedules + byes
interface WeeklyEntry { weeks: Record<number, number>; opp: Record<number, string | null> }
const weekly: Record<string, WeeklyEntry> = {};
const teamNoOpp: Record<string, Record<number, number>> = {};
const teamSeen: Record<string, Record<number, number>> = {};
const teamOppVotes: Record<string, Record<number, Record<string, number>>> = {};
for (let w = 1; w <= WEEKS; w++) {
  const rows = await fetchJson<Row[]>(weekUrl(w));
  for (const row of rows) {
    const pid = row.player_id;
    weekly[pid] = weekly[pid] ?? { weeks: {}, opp: {} };
    weekly[pid]!.weeks[w] = scoreWeek(row.stats ?? {});
    weekly[pid]!.opp[w] = row.opponent ?? null;
    if (row.team) {
      (teamSeen[row.team] = teamSeen[row.team] ?? {})[w] = (teamSeen[row.team]![w] ?? 0) + 1;
      if (!row.opponent) {
        (teamNoOpp[row.team] = teamNoOpp[row.team] ?? {})[w] = (teamNoOpp[row.team]![w] ?? 0) + 1;
      } else {
        const v = ((teamOppVotes[row.team] = teamOppVotes[row.team] ?? {})[w] =
          teamOppVotes[row.team]![w] ?? {});
        v[row.opponent] = (v[row.opponent] ?? 0) + 1;
      }
    }
  }
}
const teamSched: Record<string, Record<number, string>> = {};
for (const [t, weeks] of Object.entries(teamOppVotes)) {
  teamSched[t] = {};
  for (const [w, votes] of Object.entries(weeks)) {
    teamSched[t]![Number(w)] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]![0];
  }
}
const byes: Record<string, number> = {};
for (const t of Object.keys(teamSeen)) {
  let best: { w: number; frac: number } | null = null;
  for (let w = 1; w <= WEEKS; w++) {
    const frac = (teamNoOpp[t]?.[w] ?? 0) / (teamSeen[t]![w] ?? 1);
    if (frac > 0.8 && (best == null || frac > best.frac)) best = { w, frac };
  }
  if (best) byes[t] = best.w;
}

function weeklyFromSeason(stats: Stats, team: string | null): WeeklyEntry {
  const games = Number(stats.gp) || 17;
  const perGame: Stats = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v !== 'number') continue;
    if (k === 'gp' || k === 'cmp_pct' || /adp/.test(k) || k.startsWith('pts_')) continue;
    perGame[k] = v / games;
  }
  const pts = scoreWeek(perGame);
  const sched = (team && teamSched[team]) || null;
  const weeks: Record<number, number> = {};
  const opp: Record<number, string | null> = {};
  for (let w = 1; w <= WEEKS; w++) {
    const o = sched ? (sched[w] ?? null) : null;
    opp[w] = o;
    weeks[w] = (sched ? !!o : w <= 17) ? pts : 0;
  }
  return { weeks, opp };
}

const PROJ_STAT_KEYS = [
  'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int',
  'rush_att', 'rush_yd', 'rush_td', 'rec', 'rec_yd', 'rec_td', 'fum_lost',
  'fgm_40_49', 'fgm_50p', 'xpm',
  'idp_tkl_solo', 'idp_tkl_ast', 'idp_sack', 'idp_int', 'idp_ff',
];
function projStatLine(stats: Stats): Stats | null {
  const out: Stats = {};
  for (const k of PROJ_STAT_KEYS) if (stats[k]) out[k] = Math.round(stats[k]! * 10) / 10;
  return Object.keys(out).length ? out : null;
}
const hasWeekly = (e?: WeeklyEntry): e is WeeklyEntry =>
  !!e && Object.values(e.weeks).some((x) => x > 0);

// ------------------------------------------------------------- the table
interface Baked {
  pid: string; name: string; pos: string; group: string; team: string | null;
  bye: number | null; adp: number | null; proj: number;
  sos: number | null; po: number | null; interest: number | null;
  injury: string | null; stats: Stats | null;
  posRank?: number; vorp?: number; tier?: number;
}
const players: Baked[] = [];
for (const row of seasonProj) {
  const pid = row.player_id;
  const p = row.player ?? {};
  const m = meta[pid] ?? {};
  const pos = normalizePos(p.position ?? m.position);
  if (!pos) continue;
  const g = groupOf(pos);
  const team = row.team ?? p.team ?? m.team ?? null;
  const stats = row.stats ?? {};
  const wk = hasWeekly(weekly[pid]) ? weekly[pid]! : weeklyFromSeason(stats, team);

  let season = 0;
  const oppRanks: number[] = [];
  const poRanks: number[] = [];
  for (let w = 1; w <= WEEKS; w++) {
    season += wk.weeks[w] ?? 0;
    const opp = wk.opp[w];
    if (!opp) continue;
    const r = sosRanks[opp]?.[g];
    if (!r) continue;
    if (w <= 14) oppRanks.push(r);
    if (w >= 15 && w <= 17) poRanks.push(r);
  }
  if (!(season > 0)) continue;
  const avg = (a: number[]): number | null =>
    a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null;

  players.push({
    pid,
    name: `${p.first_name ?? m.first_name ?? ''} ${p.last_name ?? m.last_name ?? ''}`.trim(),
    pos, group: g, team,
    bye: team ? (byes[team] ?? null) : null,
    adp: stats.adp_idp_1qb && stats.adp_idp_1qb < 999 ? Math.round(stats.adp_idp_1qb * 10) / 10 : null,
    proj: Math.round(season * 10) / 10,
    sos: avg(oppRanks), po: avg(poRanks),
    interest: m.search_rank && m.search_rank < 9999999 ? m.search_rank : null,
    injury: p.injury_status ?? m.injury_status ?? null,
    stats: projStatLine(stats),
  });
}

// position ranks, replacement, VORP order, tiers — v1's exact recipe
const replacement: Record<string, number> = {};
for (const g of GROUPS) {
  const pool = players.filter((p) => p.group === g).sort((a, b) => b.proj - a.proj);
  pool.forEach((p, i) => (p.posRank = i + 1));
  const pl = pool[Math.min(replacementRank(g) - 1, pool.length - 1)];
  replacement[g] = pl ? pl.proj : 0;
}
for (const p of players) p.vorp = Math.round((p.proj - replacement[p.group]!) * 10) / 10;
players.sort((a, b) => b.vorp! - a.vorp!);
for (const g of GROUPS) {
  const pool = players.filter((p) => p.group === g).sort((a, b) => b.proj - a.proj);
  if (!pool.length) continue;
  const repl = replacement[g]!;
  let n = pool.findIndex((p) => p.proj < repl * 0.85);
  if (n === -1) n = pool.length;
  n = Math.max(n, Math.min(12, pool.length));
  let tier = 1;
  let size = 1;
  const gaps: number[] = [];
  pool.forEach((p, i) => {
    if (i >= n) return;
    if (i === 0) { p.tier = 1; return; }
    const gap = pool[i - 1]!.proj - p.proj;
    const recent = gaps.slice(-5);
    const localAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : gap;
    if ((gap >= 2.5 && gap > 2 * localAvg) || size >= 8) { tier++; size = 0; }
    gaps.push(gap);
    size++;
    p.tier = tier;
  });
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'web', 'public', 'players.json');
writeFileSync(out, JSON.stringify({ bakedAt: new Date().toISOString(), season: SEASON, replacement, players }));
console.log(`${players.length} players baked`);
console.log('top 5:', players.slice(0, 5).map((p) => `${p.name} ${p.pos} v${p.vorp}`).join(' | '));
console.log('sample columns:', JSON.stringify(players.find((p) => p.name === 'Derrick Henry') ?? players[10]));
