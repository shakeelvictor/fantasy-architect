import type { DraftState, SeasonConfig } from '@fa/rules';
import { boardSlot, overallFor, ownerOf } from '@fa/rules';
import type { PoolPlayer } from '../api';
import styles from './board.module.css';

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  cur: number | null;
}

export function Board({ config, draft, byPid, teamName, cur }: Props): React.JSX.Element {
  const byOverall = new Map(draft.picks.map((p) => [p.overall, p]));
  const keeperAt = new Map(draft.keepers.map((k) => [overallFor(config, k.slot, k.round), k]));
  const latest = draft.picks.reduce((m, p) => Math.max(m, p.overall), 0);
  const rounds = Array.from({ length: config.rounds }, (_, r) => r + 1);
  const slots = Array.from({ length: config.teams }, (_, s) => s + 1);

  return (
    <section className={styles.board}>
      <div className={styles.grid} style={{ gridTemplateColumns: `34px repeat(${config.teams}, minmax(88px, 1fr))` }}>
        <div />
        {slots.map((s) => (
          <div key={s} className={styles.head}>
            {teamName(s)}
          </div>
        ))}
        {rounds.map((r) => (
          <RoundRow key={r} r={r} {...{ config, draft, byOverall, keeperAt, byPid, teamName, cur, slots, latest }} />
        ))}
      </div>
    </section>
  );
}

function RoundRow({
  r, config, draft, byOverall, keeperAt, byPid, teamName, cur, slots, latest,
}: {
  r: number;
  config: SeasonConfig;
  draft: DraftState;
  byOverall: Map<number, { pid: string; slot: number; is_keeper: boolean }>;
  keeperAt: Map<number, { pid: string; slot: number }>;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  cur: number | null;
  slots: number[];
  latest: number;
}): React.JSX.Element {
  return (
    <>
      <div className={`${styles.roundLabel} mono`}>R{r}</div>
      {slots.map((s) => {
        const overall = overallFor(config, s, r);
        const col = boardSlot(config, overall); // board column stays with the original slot
        void col;
        const pick = byOverall.get(overall);
        const pending = !pick ? keeperAt.get(overall) : undefined;
        const pid = pick?.pid ?? pending?.pid;
        const pl = pid ? byPid.get(pid) : undefined;
        const owner = ownerOf(config, draft, overall);
        const traded = !pick && owner !== s;
        const movedIn = pick && pick.slot !== s;
        const group = pl?.group ?? '';
        return (
          <div
            key={s}
            data-testid={`cell-${overall}`}
            className={[
              styles.cell,
              pl ? (styles[`c_${group}`] ?? '') : '',
              pick ? styles.filled : '',
              pending ? styles.pending : '',
              overall === cur ? styles.onclock : '',
              pick && overall === latest ? styles.latest : '',
            ].join(' ')}
            title={traded ? `Pick #${overall} — traded from ${teamName(s)} to ${teamName(owner)}` : undefined}
          >
            {pl ? (
              <>
                <span className={styles.pname}>
                  {pick?.is_keeper || pending ? '🔒 ' : ''}
                  {movedIn ? '↔ ' : ''}
                  {pl.name}
                </span>
                <small className="mono">
                  {pl.pos} · {pl.team ?? 'FA'} · #{overall}
                </small>
              </>
            ) : (
              <>
                <small className="mono">#{overall}</small>
                {traded && <small className={styles.tradedTo}>→ {teamName(owner)}</small>}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
