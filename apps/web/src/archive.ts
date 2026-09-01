// Draft archives — v1's buildArchive over v2 state: a finished draft becomes
// a standalone JSON document (every pick with this league's scoring, final
// rosters, trades), downloaded and committed to public/drafts/ where the
// Past Drafts tab reads it forever. Same schema/kind as v1, so v1's 2026
// archive renders here and a v2 archive would render there.

import { rosterBalance, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from './api';

export interface ArchivePick {
  overall: number; round: number; slot: number; origSlot?: number;
  pid: string; name: string; pos: string; team: string | null; keeper: boolean;
}
export interface ArchiveTeam {
  slot: number; name: string; projectedPoints: number;
  roster: (ArchivePick & { proj: number | null; adp: number | null })[];
}
export interface ArchiveDoc {
  schema: number; kind: string; season: number; league: string;
  archivedAt: string; complete: boolean;
  rosterBalance: { target: number; balanced: boolean; offenders: unknown[] };
  scoring: string;
  config: SeasonConfig & { order?: string[] };
  teams: ArchiveTeam[];
  picks: ArchivePick[];
  keepers: unknown[];
  trades: unknown[];
  tradeLog?: { status?: string; detail?: string; note?: string }[];
}

export function buildArchive(
  config: SeasonConfig, draft: DraftState, byPid: Map<string, PoolPlayer>,
  teamName: (slot: number) => string, season: number,
): ArchiveDoc {
  const picks: ArchivePick[] = draft.picks.map((pk) => {
    const p = byPid.get(pk.pid);
    return {
      overall: pk.overall, round: pk.round, slot: pk.slot,
      pid: pk.pid, name: p?.name ?? pk.pid, pos: p?.pos ?? '', team: p?.team ?? null,
      keeper: pk.is_keeper,
    };
  });
  const teams: ArchiveTeam[] = Array.from({ length: config.teams }, (_, i) => {
    const slot = i + 1;
    const roster = draft.picks.filter((pk) => pk.slot === slot).map((pk) => {
      const p = byPid.get(pk.pid);
      return {
        pid: pk.pid, name: p?.name ?? pk.pid, pos: p?.pos ?? '', team: p?.team ?? null,
        round: pk.round, overall: pk.overall, slot, keeper: pk.is_keeper,
        proj: p ? Math.round(p.proj * 10) / 10 : null,
        adp: p?.adp ?? null,
      };
    });
    return {
      slot, name: teamName(slot), roster,
      projectedPoints: Math.round(roster.reduce((a, r) => a + (r.proj ?? 0), 0)),
    };
  });
  const bal = rosterBalance(config, draft);
  return {
    schema: 1, kind: 'imp-draft-archive',
    season, league: 'MFL',
    archivedAt: new Date().toISOString(),
    complete: draft.picks.length >= config.teams * config.rounds,
    rosterBalance: { target: bal.target, balanced: bal.balanced, offenders: bal.offenders },
    scoring: 'IMP league rules (fflr.netlify.app/rules#scoring)',
    config,
    teams,
    picks,
    keepers: draft.keepers,
    trades: draft.trades,
  };
}
