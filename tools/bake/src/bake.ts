// The daily data bake: Sleeper → players.json, standalone (no v1 cache).
// Fetches the full player meta + season projections, scores through the
// golden-tested @fa/scoring engine — dividing the season line by games
// played BEFORE scoring, because the yardage bonus tiers are per game and
// scoring a season total pays a backup QB a 300-yard bonus every week —
// then ranks by VORP, not raw points: raw points stacks 11 QBs on top of a
// 1-QB league. Replacement ranks are v1's, scaled from the league config.
//
// Runs in CI daily (and on demand): pnpm --filter @fa/bake bake

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreWeek } from '@fa/scoring';

const SEASON = process.env.BAKE_SEASON ?? '2026';
const TEAMS = Number(process.env.BAKE_TEAMS ?? 11);

const OFF_POS = ['QB', 'RB', 'WR', 'TE', 'K'];
const REQUEST_POS = [...OFF_POS, 'DL', 'LB', 'DB'];
// the feed is requested by group but players come back with specific
// positions — normalize or lose Garrett/Bosa/etc. (the v1 lesson)
const IDP_POS = new Set(['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'SS', 'FS']);

function group(pos: string): string | null {
  if (OFF_POS.includes(pos)) return pos;
  if (IDP_POS.has(pos)) return 'IDP';
  return null; // OL, LS, P — deliberately out of the pool
}

// v1 replacementRank(), parameterized by team count
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

interface Row {
  player_id: string;
  team?: string | null;
  player?: { first_name?: string; last_name?: string; position?: string; team?: string };
  stats?: Record<string, number>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

const posParams = REQUEST_POS.map((p) => `position[]=${p}`).join('&');
const [meta, rows] = await Promise.all([
  fetchJson<Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }>>(
    'https://api.sleeper.app/v1/players/nfl',
  ),
  fetchJson<Row[]>(
    `https://api.sleeper.app/projections/nfl/${SEASON}?season_type=regular&${posParams}&order_by=adp_idp_1qb`,
  ),
]);

interface Baked {
  pid: string;
  name: string;
  pos: string;
  group: string;
  team: string | null;
  proj: number;
  adp: number | null;
  posRank?: number;
  vorp?: number;
  tier?: number;
}

const players: Baked[] = [];
for (const row of rows) {
  const m = meta[row.player_id] ?? {};
  const p = row.player ?? {};
  const pos = p.position ?? m.position ?? '';
  const g = group(pos);
  if (!g) continue;
  const stats = row.stats ?? {};
  const gp = Number(stats.gp) || 17;
  const perGame: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === 'number' && !k.startsWith('adp') && k !== 'gp') perGame[k] = v / gp;
  }
  const proj = scoreWeek(perGame) * gp;
  if (!(proj > 0)) continue;
  players.push({
    pid: row.player_id,
    name: `${p.first_name ?? m.first_name ?? ''} ${p.last_name ?? m.last_name ?? ''}`.trim(),
    pos,
    group: g,
    team: row.team ?? p.team ?? m.team ?? null,
    proj: Math.round(proj * 10) / 10,
    adp: stats.adp_idp_1qb && stats.adp_idp_1qb < 999 ? Math.round(stats.adp_idp_1qb * 10) / 10 : null,
  });
}

// position ranks + replacement level per group, then VORP ordering
const replacement: Record<string, number> = {};
for (const g of [...OFF_POS, 'IDP']) {
  const pool = players.filter((p) => p.group === g).sort((a, b) => b.proj - a.proj);
  pool.forEach((p, i) => (p.posRank = i + 1));
  const pl = pool[Math.min(replacementRank(g) - 1, pool.length - 1)];
  replacement[g] = pl ? pl.proj : 0;
}
for (const p of players) p.vorp = Math.round((p.proj - replacement[p.group]!) * 10) / 10;
players.sort((a, b) => b.vorp! - a.vorp!);

// v1's value-based tiers: a new tier starts at a real gap in custom points —
// >=2.5 pts AND >2x the local average spacing, max tier size 8, tiered down
// to a bit past replacement; the deep tail stays untiered ("The rest").
for (const g of [...OFF_POS, 'IDP']) {
  const pool = players.filter((p) => p.group === g).sort((a, b) => b.proj - a.proj);
  if (!pool.length) continue;
  const repl = replacement[g]!;
  let n = pool.findIndex((p) => p.proj < repl * 0.85);
  if (n === -1) n = pool.length;
  n = Math.max(n, Math.min(12, pool.length));
  let tier = 1;
  let sizeInTier = 1;
  const gaps: number[] = [];
  pool.forEach((p, i) => {
    if (i >= n) return;
    if (i === 0) { p.tier = 1; return; }
    const gap = pool[i - 1]!.proj - p.proj;
    const recent = gaps.slice(-5);
    const localAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : gap;
    if ((gap >= 2.5 && gap > 2 * localAvg) || sizeInTier >= 8) { tier++; sizeInTier = 0; }
    gaps.push(gap);
    sizeInTier++;
    p.tier = tier;
  });
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'web', 'public', 'players.json');
writeFileSync(out, JSON.stringify({ bakedAt: new Date().toISOString(), season: SEASON, replacement, players }));
console.log(`${players.length} players baked, VORP-ranked`);
console.log('top 5:', players.slice(0, 5).map((p) => `${p.name} (${p.pos}) vorp ${p.vorp}`).join(' | '));
console.log('replacement:', JSON.stringify(replacement));
