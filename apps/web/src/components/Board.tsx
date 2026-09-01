import type { DraftState, SeasonConfig } from '@fa/rules';
import { overallFor } from '@fa/rules';
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
  const keeperAt = new Map(
    draft.keepers.map((k) => [overallFor(config, k.slot, k.round), k]),
  );
  const rounds = Array.from({ length: config.rounds }, (_, r) => r + 1);
  const slots = Array.from({ length: config.teams }, (_, s) => s + 1);

  return (
    <section className={styles.board}>
      <div className={styles.grid} style={{ gridTemplateColumns: `34px repeat(${config.teams}, minmax(84px, 1fr))` }}>
        <div />
        {slots.map((s) => (
          <div key={s} className={styles.head}>
            {teamName(s)}
          </div>
        ))}
        {rounds.map((r) => (
          <RoundRow key={r} r={r} {...{ config, byOverall, keeperAt, byPid, cur, slots }} />
        ))}
      </div>
    </section>
  );
}

function RoundRow({
  r, config, byOverall, keeperAt, byPid, cur, slots,
}: {
  r: number;
  config: SeasonConfig;
  byOverall: Map<number, { pid: string; slot: number; is_keeper: boolean }>;
  keeperAt: Map<number, { pid: string; slot: number }>;
  byPid: Map<string, PoolPlayer>;
  cur: number | null;
  slots: number[];
}): React.JSX.Element {
  return (
    <>
      <div className={`${styles.roundLabel} num`}>R{r}</div>
      {slots.map((s) => {
        const overall = (r - 1) * config.teams + s;
        const pick = byOverall.get(overall);
        const pending = !pick ? keeperAt.get(overall) : undefined;
        const name = pick ? (byPid.get(pick.pid)?.name ?? pick.pid) : pending ? (byPid.get(pending.pid)?.name ?? pending.pid) : null;
        return (
          <div
            key={s}
            data-testid={`cell-${overall}`}
            className={[
              styles.cell,
              pick ? styles.filled : '',
              pending ? styles.pending : '',
              overall === cur ? styles.onclock : '',
            ].join(' ')}
          >
            {name ? (
              <>
                <span className={styles.pname}>
                  {pick?.is_keeper || pending ? '🔒 ' : ''}
                  {name}
                </span>
                <small className="num">#{overall}</small>
              </>
            ) : (
              <small className="num">#{overall}</small>
            )}
          </div>
        );
      })}
    </>
  );
}
