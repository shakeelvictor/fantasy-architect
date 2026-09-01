// Draft archives — v1's buildArchive over v2 state: a finished draft becomes
// a standalone JSON document (every pick with this league's scoring, final
// rosters, trades), downloaded and committed to public/drafts/ where the
// Past Drafts tab reads it forever. Same schema/kind as v1, so v1's 2026
// archive renders here and a v2 archive would render there.

import { rosterBalance, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from './pool';
import { computeGrades, type TeamGrade } from './grades';

export interface ArchivePick {
  overall: number; round: number; slot: number; origSlot?: number;
  pid: string; name: string; pos: string; team: string | null; keeper: boolean;
}
export interface ArchiveTeam {
  slot: number; name: string; projectedPoints: number;
  roster: (ArchivePick & { proj: number | null; adp: number | null; vorp?: number | null })[];
  // the assessment as it stood on draft night, pinned into the document so a
  // later retrospective judges what was actually said rather than what a
  // changed formula would say today
  draftGrade?: string;
  draftZ?: number;
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
        // the grade's own input, so the document can be re-graded years later
        // without the bake that produced it
        vorp: p?.vorp ?? null,
      };
    });
    return {
      slot, name: teamName(slot), roster,
      projectedPoints: Math.round(roster.reduce((a, r) => a + (r.proj ?? 0), 0)),
    };
  });
  const bal = rosterBalance(config, draft);
  const grades = computeGrades(teams.map((t) => ({
    slot: t.slot,
    name: t.name,
    roster: t.roster.map((r) => ({ proj: r.proj ?? 0, vorp: r.vorp ?? 0 })),
  })));
  for (const t of teams) {
    const g = grades.find((x) => x.slot === t.slot);
    if (g) { t.draftGrade = g.grade; t.draftZ = Math.round(g.z * 1000) / 1000; }
  }
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

/** Grade an archived draft, preferring the letter pinned into the document —
 *  what was actually said that night, not what today's formula would say. */
export function gradesFromArchive(doc: ArchiveDoc): TeamGrade[] {
  const computed = computeGrades(doc.teams.map((t) => ({
    slot: t.slot, name: t.name,
    roster: t.roster.map((r) => ({ proj: r.proj ?? 0, vorp: r.vorp ?? 0 })),
  })));
  return computed.map((g) => ({
    ...g,
    grade: doc.teams.find((t) => t.slot === g.slot)?.draftGrade ?? g.grade,
  }));
}
