import { useState } from 'react';
import { overallFor, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import styles from './teams.module.css';

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  mySlot: number | null;
}

export function TeamsTab({ config, draft, byPid, teamName, mySlot }: Props): React.JSX.Element {
  const [view, setView] = useState(mySlot ?? 1);

  const picks = draft.picks
    .filter((p) => p.slot === view)
    .sort((a, b) => a.overall - b.overall);
  const pending = draft.keepers
    .filter((k) => k.slot === view && !draft.picks.some((p) => p.pid === k.pid))
    .sort((a, b) => a.round - b.round);
  const total = picks.reduce((sum, p) => sum + (byPid.get(p.pid)?.proj ?? 0), 0);

  return (
    <section className={styles.wrap} data-testid="teams-tab">
      <div className={styles.chips}>
        {Array.from({ length: config.teams }, (_, i) => i + 1).map((s) => (
          <button
            key={s}
            data-testid={`team-chip-${s}`}
            className={s === view ? styles.active : ''}
            onClick={() => setView(s)}
          >
            {teamName(s)}
            {s === mySlot ? ' ·you' : ''}
            <span className={styles.count}>{draft.picks.filter((p) => p.slot === s).length}</span>
          </button>
        ))}
      </div>
      <div className={styles.roster} data-testid="team-roster">
        <h3>
          {teamName(view)} — {picks.length}/{config.rounds} players · {total.toFixed(0)} projected pts
        </h3>
        {picks.map((p) => {
          const pl = byPid.get(p.pid);
          return (
            <div key={p.overall} className={styles.row}>
              <span className={`${styles.pos} num`}>R{p.round}</span>
              <b>
                {p.is_keeper ? '🔒 ' : ''}
                {pl?.name ?? p.pid}
              </b>
              <small>
                {pl ? `${pl.pos} · ${pl.team ?? 'FA'} · ${pl.proj.toFixed(0)} pts` : ''} · #{p.overall}
              </small>
            </div>
          );
        })}
        {pending.map((k) => (
          <div key={k.pid} className={`${styles.row} ${styles.pending}`}>
            <span className={`${styles.pos} num`}>R{k.round}</span>
            <b>🔒 {byPid.get(k.pid)?.name ?? k.pid}</b>
            <small>keeper — lands at #{overallFor(config, k.slot, k.round)}</small>
          </div>
        ))}
        {picks.length === 0 && pending.length === 0 && <p className={styles.empty}>No players yet.</p>}
      </div>
    </section>
  );
}
