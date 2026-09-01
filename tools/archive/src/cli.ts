// Publish a finished draft as a permanent record, without anyone having to
// remember to. Reads the season's log straight from Supabase (anon — the log
// is world-readable by design), folds it, builds the archive document, and
// writes it into apps/web/public/drafts/ for the daily workflow to commit.
//
// Before this, the only path was: click "Archive current draft", let it land
// in a Downloads folder, and hand-commit it. That last mile is exactly the
// spreadsheet-on-a-laptop failure the app exists to avoid.
//
//   pnpm --filter @fa/archive archive            # season from ARCHIVE_SEASON
//   ARCHIVE_SEASON=2027 pnpm --filter @fa/archive archive
//
// env: SUPABASE_URL, SUPABASE_ANON_KEY (both already GitHub secrets).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DraftEvent, SeasonConfig } from '@fa/rules';
import { planArchive, withSeason, type IndexEntry, type Pool } from './plan.ts';
import type { ArchiveDoc } from '../../../apps/web/src/archive.ts';

const SEASON = Number(process.env.ARCHIVE_SEASON ?? 2027);
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'web', 'public');
const DRAFTS = join(PUB, 'drafts');

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY!, authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const readJson = <T>(p: string): T | null =>
  existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;

if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  process.exit(1);
}

const [seasons, events] = await Promise.all([
  rest<{ config: SeasonConfig }[]>(`seasons?year=eq.${SEASON}&select=config`),
  rest<DraftEvent[]>(`draft_events?season=eq.${SEASON}&select=seq,type,payload&order=seq`),
]);
if (!seasons[0]) {
  console.log(`season ${SEASON} is not seeded — nothing to archive`);
  process.exit(0);
}

const pool = readJson<Pool>(join(PUB, 'players.json'));
if (!pool) throw new Error('players.json is missing — run the bake first');

const file = join(DRAFTS, `${SEASON}.json`);
const plan = planArchive({
  season: SEASON,
  config: seasons[0].config,
  events,
  pool,
  existing: readJson<ArchiveDoc>(file),
});

if (plan.action === 'skip') {
  console.log(`no archive written for ${SEASON}: ${plan.reason}`);
  process.exit(0);
}

mkdirSync(DRAFTS, { recursive: true });
writeFileSync(file, JSON.stringify(plan.doc, null, 2));
const indexPath = join(DRAFTS, 'index.json');
const index = withSeason(readJson<IndexEntry[]>(indexPath) ?? [], SEASON);
writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(
  `archived ${SEASON} (${plan.reason}) — ${plan.doc.picks.length} picks, `
  + `${plan.doc.teams.length} teams → drafts/${SEASON}.json`,
);
