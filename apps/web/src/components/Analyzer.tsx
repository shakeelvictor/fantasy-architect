// The Analyzer's grade grid: projected points, value over replacement, and a
// letter per team from the VORP z-score — v1's grading, minus the hot-take
// generator (that carnival arrives later).

import type { DraftState, SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import { pendingKeepersForSlot, rosterForSlot } from '../v1logic';

function letterGrade(z: number): string {
  if (z >= 0.8) return 'A';
  if (z >= 0.25) return 'B';
  if (z >= -0.25) return 'C';
  if (z >= -0.8) return 'D';
  return 'F';
}

export function Analyzer({ config, draft, byPid, teamName }: {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
}): React.JSX.Element {
  const teams = Array.from({ length: config.teams }, (_, i) => i + 1).map((slot) => {
    const roster = [...rosterForSlot(byPid, draft, slot), ...pendingKeepersForSlot(byPid, draft, slot).map((x) => x.p)];
    const proj = roster.reduce((a, p) => a + p.proj, 0);
    const value = roster.reduce((a, p) => a + Math.max(p.vorp ?? 0, 0), 0);
    return { slot, roster, proj, value };
  });
  const drafted = teams.filter((t) => t.roster.length > 0);
  const mean = drafted.length ? drafted.reduce((a, t) => a + t.value, 0) / drafted.length : 0;
  const sd = drafted.length
    ? Math.sqrt(drafted.reduce((a, t) => a + (t.value - mean) ** 2, 0) / drafted.length) || 1
    : 1;

  return (
    <div className="analyzer" id="analyzer-content">
      <div className="grade-grid">
        {teams.map((t) => {
          const grade = t.roster.length ? letterGrade((t.value - mean) / sd) : '—';
          return (
            <div key={t.slot} className="grade-card" data-slot={t.slot}>
              <div className="grade-head">
                <b>{teamName(t.slot)}</b>
                <span className={`grade g-${grade}`}>{grade}</span>
              </div>
              <div className="grade-stats">
                Projected points: <b>{t.proj.toFixed(0)}</b><br />
                Value over replacement: <b>{t.value.toFixed(0)}</b><br />
                Picks made: <b>{draft.picks.filter((p) => p.slot === t.slot).length}</b>
              </div>
            </div>
          );
        })}
      </div>
      {!draft.picks.length && (
        <p className="p-meta" style={{ marginTop: 12 }}>Grades sharpen as picks land.</p>
      )}
    </div>
  );
}
