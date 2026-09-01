// Golden-master fixture generator for packages/scoring.
//
// The oracle for a port is the ORIGINAL engine run over the same inputs —
// not the archived draft numbers, which drift as Sleeper republishes
// projections daily. This script loads v1's public/scoring.js (CommonJS,
// unchanged) and records its output for every real stat line in v1's data
// cache: full-season projections, three weekly projection files, and three
// weeks of 2025 actuals. Each case stores both scoring modes:
//   ev — scoreWeek(stats)        probability-weighted (projections)
//   ex — scoreWeek(stats, true)  exact thresholds (finished games)
//
// Usage: node scripts/generate-golden-fixtures.mjs /path/to/fantasy-draft-assistant
//
// Regenerate ONLY from a v1 checkout you trust, and eyeball the diff: these
// fixtures are the spec. A regeneration that changes values means the v1
// engine changed, not that the port is wrong.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const v1 = process.argv[2];
if (!v1) {
  console.error('usage: node scripts/generate-golden-fixtures.mjs <path-to-v1-repo>');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { scoreWeek } = require(join(v1, 'public', 'scoring.js'));

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'scoring', 'test', 'fixtures');
mkdirSync(outDir, { recursive: true });

const DATASETS = [
  'proj-season.json',
  'proj-w1.json',
  'proj-w9.json',
  'proj-w17.json',
  'stats-2025-w1.json',
  'stats-2025-w9.json',
  'stats-2025-w17.json',
];

// adp_* keys are draft-position metadata, not stats — scoring never reads
// them and they double the fixture size for nothing.
function trimStats(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats)) {
    if (k.startsWith('adp')) continue;
    out[k] = v;
  }
  return out;
}

let total = 0;
for (const file of DATASETS) {
  const rows = JSON.parse(readFileSync(join(v1, 'data', 'cache', file), 'utf8'));
  const cases = [];
  for (const row of rows) {
    const stats = row && row.stats;
    if (!stats || Object.keys(stats).length === 0) continue;
    const s = trimStats(stats);
    cases.push({ pid: row.player_id ?? null, s, ev: scoreWeek(s), ex: scoreWeek(s, true) });
  }
  const fixture = {
    source: `v1 data/cache/${file}`,
    engine: 'v1 public/scoring.js',
    generatedAt: new Date().toISOString(),
    cases,
  };
  const outFile = join(outDir, file.replace('.json', '.golden.json'));
  writeFileSync(outFile, JSON.stringify(fixture));
  console.log(`${file}: ${cases.length} cases -> ${outFile.split('/').pop()}`);
  total += cases.length;
}
console.log(`total: ${total} golden cases`);
