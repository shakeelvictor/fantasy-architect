// Bake the player pool for the app from v1's data cache. Scoring runs
// through v1's engine (golden-proven identical to @fa/scoring) with the rule
// CLAUDE.md is emphatic about: divide the season line by games played BEFORE
// scoring — the yardage bonus tiers are per-game, and scoring a season total
// pays a backup QB a 300-yard bonus every week. proj = perGame × gp.
//
// Usage: node scripts/bake-players.mjs <path-to-v1-repo>
// Writes apps/web/public/players.json — the slice's read-only reference data
// (in production this is the daily Netlify bake, exactly as v1 does it).

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const v1 = process.argv[2];
if (!v1) {
  console.error('usage: node scripts/bake-players.mjs <path-to-v1-repo>');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const { scoreWeek } = require(join(v1, 'public', 'scoring.js'));

const POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'CB', 'S', 'SS', 'FS', 'DL', 'DB']);
const GROUP = (p) => (['QB', 'RB', 'WR', 'TE', 'K'].includes(p) ? p : 'IDP');

const rows = JSON.parse(readFileSync(join(v1, 'data', 'cache', 'proj-season.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(v1, 'data', 'cache', 'players.json'), 'utf8'));

const players = [];
for (const row of rows) {
  const m = meta[row.player_id] ?? {};
  const p = row.player ?? {};
  const pos = p.position ?? m.position;
  if (!POS.has(pos)) continue;
  const stats = row.stats ?? {};
  const gp = Number(stats.gp) || 17;
  const perGame = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === 'number' && !k.startsWith('adp') && k !== 'gp') perGame[k] = v / gp;
  }
  const proj = scoreWeek(perGame) * gp;
  if (!(proj > 0)) continue;
  players.push({
    pid: row.player_id,
    name: `${p.first_name ?? m.first_name ?? ''} ${p.last_name ?? m.last_name ?? ''}`.trim(),
    pos,
    group: GROUP(pos),
    team: row.team ?? p.team ?? m.team ?? null,
    proj: Math.round(proj * 10) / 10,
    adp: stats.adp_idp_1qb && stats.adp_idp_1qb < 999 ? Math.round(stats.adp_idp_1qb * 10) / 10 : null,
  });
}
players.sort((a, b) => b.proj - a.proj);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'players.json');
writeFileSync(out, JSON.stringify({ bakedAt: new Date().toISOString(), players }));
console.log(`${players.length} players -> apps/web/public/players.json`);
