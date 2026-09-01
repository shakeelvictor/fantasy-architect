// v1's board grid, verbatim classes: c-<group> colored cells, bc-name /
// bc-meta lines, dashed keeper-pending, onclock ring, latest glow, and
// traded empty picks pointing at their new owner.

import type { DraftState, SeasonConfig } from '@fa/rules';
import { overallFor, ownerOf } from '@fa/rules';
import type { PoolPlayer } from '../api';

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  cur: number | null;
  onOpen?: (pid: string) => void;
}

export function Board({ config, draft, byPid, teamName, cur, onOpen }: Props): React.JSX.Element {
  const byOverall = new Map(draft.picks.map((p) => [p.overall, p]));
  const keeperAt = new Map(draft.keepers.map((k) => [overallFor(config, k.slot, k.round), k]));
  const latest = draft.picks.reduce((m, p) => Math.max(m, p.overall), 0);
  const rounds = Array.from({ length: config.rounds }, (_, r) => r + 1);
  const slots = Array.from({ length: config.teams }, (_, s) => s + 1);

  return (
    <div className="board-wrap" id="board-wrap">
      <div className="board-grid" style={{ gridTemplateColumns: `34px repeat(${config.teams}, minmax(78px, 1fr))` }}>
        <div />
        {slots.map((s) => (
          <div key={s} className="board-head">{teamName(s)}</div>
        ))}
        {rounds.map((r) => (
          <RoundRow key={r} {...{ r, config, draft, byOverall, keeperAt, byPid, teamName, cur, slots, latest, onOpen }} />
        ))}
      </div>
    </div>
  );
}

function RoundRow({ r, config, draft, byOverall, keeperAt, byPid, teamName, cur, slots, latest, onOpen }: {
  r: number;
  config: SeasonConfig;
  draft: DraftState;
  byOverall: Map<number, { pid: string; slot: number; is_keeper: boolean }>;
  keeperAt: Map<number, { pid: string; slot: number; round: number }>;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  cur: number | null;
  slots: number[];
  latest: number;
  onOpen?: ((pid: string) => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      <div className="round-label">R{r}</div>
      {slots.map((s) => {
        const overall = overallFor(config, s, r);
        const pick = byOverall.get(overall);
        const pending = !pick ? keeperAt.get(overall) : undefined;
        const pid = pick?.pid ?? pending?.pid;
        const pl = pid ? byPid.get(pid) : undefined;
        const owner = ownerOf(config, draft, overall);
        const traded = !pick && owner !== s;
        const movedIn = pick && pick.slot !== s;
        const cls = [
          'board-cell',
          pl ? `c-${pl.group}` : '',
          pending ? 'keeper-pending' : '',
          overall === cur ? 'onclock' : '',
          pick && overall === latest ? 'latest' : '',
          traded ? 'traded' : '',
        ].join(' ');
        return (
          <div key={s} data-testid={`cell-${overall}`} data-pid={pid ?? undefined} className={cls}
            title={traded ? `Pick #${overall} — traded from ${teamName(s)} to ${teamName(owner)}` : undefined}
            onClick={pid ? () => onOpen?.(pid) : undefined}>
            {pl ? (
              <>
                <div className="bc-name">
                  {(pick?.is_keeper || pending) ? '🔒 ' : ''}{movedIn ? '↔ ' : ''}{pl.name}
                </div>
                <div className="bc-meta">
                  {pl.pos} · {pl.team ?? 'FA'} · #{overall}
                  {movedIn ? ` · → ${teamName(pick!.slot)}` : ''}
                </div>
              </>
            ) : (
              <>
                <div className="bc-meta">#{overall}</div>
                {traded && <div className="bc-traded">→ {teamName(owner)}</div>}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
