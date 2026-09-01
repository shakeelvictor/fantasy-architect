// The Excel export — v1's exportXlsx over v2 state: three sheets (Pick Log,
// Draft Board rounds×teams, Rosters with projected totals), built entirely
// client-side with the zero-dependency OOXML writer.

import { overallFor, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from './api';
import { buildXlsx, type Cell } from './xlsx';

export function downloadBlob(bytes: Uint8Array, filename: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function exportXlsx(
  config: SeasonConfig, draft: DraftState, byPid: Map<string, PoolPlayer>,
  teamName: (slot: number) => string, season: number,
): void {
  if (!draft.picks.length) return;
  const pir = (overall: number): number => ((overall - 1) % config.teams) + 1;

  // Sheet 1: pick log
  const logRows: Cell[][] = [[
    'Overall', 'Round', 'Pick', 'Team', 'Player', 'Pos', 'NFL Team', 'Bye',
    'Proj (custom)', 'ADP', 'Value vs ADP', 'Keeper',
  ]];
  for (const pk of draft.picks) {
    const pl = byPid.get(pk.pid);
    logRows.push([
      pk.overall, pk.round, `${pk.round}.${String(pir(pk.overall)).padStart(2, '0')}`,
      teamName(pk.slot), pl?.name ?? pk.pid, pl?.pos ?? '', pl?.team ?? '',
      pl?.bye ?? '', pl?.proj ?? '', pl?.adp ?? '',
      pl?.adp != null ? Math.round(pl.adp - pk.overall) : '',
      pk.is_keeper ? 'Y' : '',
    ]);
  }

  // Sheet 2: board grid (rounds × teams)
  const byOverall = new Map(draft.picks.map((pk) => [pk.overall, pk]));
  const order = Array.from({ length: config.teams }, (_, i) => teamName(i + 1));
  const boardRows: Cell[][] = [['Round', ...order]];
  for (let r = 1; r <= config.rounds; r++) {
    const row: Cell[] = [r];
    for (let s = 1; s <= config.teams; s++) {
      const pk = byOverall.get(overallFor(config, s, r));
      const pl = pk && byPid.get(pk.pid);
      row.push(pk ? `${pl?.name ?? pk.pid} (${pl?.pos ?? '?'})${pk.is_keeper ? ' [K]' : ''}` : '');
    }
    boardRows.push(row);
  }

  // Sheet 3: rosters by team, with projected totals
  const rosterCols: typeof draft.picks[] = [];
  let maxLen = 0;
  for (let s = 1; s <= config.teams; s++) {
    const roster = draft.picks.filter((pk) => pk.slot === s);
    rosterCols.push(roster);
    maxLen = Math.max(maxLen, roster.length);
  }
  const rosterRows: Cell[][] = [[...order]];
  for (let i = 0; i < maxLen; i++) {
    rosterRows.push(rosterCols.map((col) => {
      const pk = col[i];
      const pl = pk && byPid.get(pk.pid);
      return pk ? `${pl?.name ?? pk.pid} (${pl?.pos ?? '?'})` : '';
    }));
  }
  rosterRows.push(rosterCols.map((col) =>
    Math.round(col.reduce((a, pk) => a + (byPid.get(pk.pid)?.proj ?? 0), 0))));

  const bytes = buildXlsx([
    { name: 'Pick Log', rows: logRows },
    { name: 'Draft Board', rows: boardRows },
    { name: 'Rosters', rows: rosterRows },
  ]);
  downloadBlob(bytes, `fa-draft-${season}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
