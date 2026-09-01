// Deciding whether a season should be archived, and to what — kept pure so
// the interesting rules are testable without a network or a filesystem.
//
// The document itself is built by apps/web/src/archive.ts, the SAME module
// the "Archive current draft" button uses. That sharing is the point: an
// archive published by CI and one downloaded by hand are byte-identical by
// construction rather than by two implementations agreeing to stay in step.

import { foldEvents, type DraftEvent, type SeasonConfig } from '@fa/rules';
import { buildArchive, type ArchiveDoc } from '../../../apps/web/src/archive.ts';
import type { PoolPlayer } from '../../../apps/web/src/pool.ts';

export interface Pool { season: string; players: PoolPlayer[] }

export interface PlanInput {
  season: number;
  config: SeasonConfig;
  events: DraftEvent[];
  pool: Pool;
  existing: ArchiveDoc | null;
}

export type Plan =
  | { action: 'skip'; reason: string }
  | { action: 'write'; reason: string; doc: ArchiveDoc };

/** Strip the one field that always differs, so an unchanged board is
 *  recognised as unchanged and the daily run does not commit noise. */
function sansTimestamp(doc: ArchiveDoc): string {
  return JSON.stringify({ ...doc, archivedAt: '' });
}

export function planArchive(input: PlanInput): Plan {
  const { season, config, events, pool, existing } = input;

  // A draft can only be rebuilt from the pool it was drafted out of. Once the
  // bake rolls to the next season, players.json holds different projections
  // and VORP, so re-deriving an old year would quietly restate its grades
  // with numbers nobody drafted against. That makes an archive effectively
  // frozen the moment the pool moves on — which is the correct behaviour, not
  // a limitation.
  if (pool.season !== String(season)) {
    return {
      action: 'skip',
      reason: `players.json is the ${pool.season} pool, so ${season} cannot be rebuilt faithfully`,
    };
  }

  const draft = foldEvents(events);
  const total = config.teams * config.rounds;
  if (!draft.completed && draft.picks.length < total) {
    return { action: 'skip', reason: `draft is ${draft.picks.length} of ${total} picks` };
  }

  const byPid = new Map(pool.players.map((p) => [p.pid, p]));
  const teamName = (slot: number): string => config.order?.[slot - 1] ?? `Team ${slot}`;
  const doc = buildArchive(config, draft, byPid, teamName, season);

  if (existing && sansTimestamp(existing) === sansTimestamp(doc)) {
    return { action: 'skip', reason: 'already archived, unchanged' };
  }
  return {
    action: 'write',
    reason: existing ? 'the board changed since it was archived' : 'newly complete',
    doc: existing ? { ...doc, archivedAt: doc.archivedAt } : doc,
  };
}

export interface IndexEntry { season: number; file: string; label?: string }

/** Add a season to drafts/index.json, newest first, without disturbing the
 *  entries already there (2026 came from v1 and has a hand-written label). */
export function withSeason(index: IndexEntry[], season: number): IndexEntry[] {
  const rest = index.filter((e) => e.season !== season);
  return [...rest, { season, file: `${season}.json`, label: String(season) }]
    .sort((a, b) => b.season - a.season);
}
