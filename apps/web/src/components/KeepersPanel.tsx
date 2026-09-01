import { useMemo, useState } from 'react';
import { overallFor, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import styles from './panel.module.css';

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  players: PoolPlayer[];
  teamName: (slot: number) => string;
  act: (type: string, payload: Record<string, unknown>) => void;
  onClose: () => void;
}

export function KeepersPanel({ config, draft, byPid, players, teamName, act, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [slot, setSlot] = useState(1);
  const [round, setRound] = useState('');

  const taken = useMemo(
    () => new Set([...draft.picks.map((p) => p.pid), ...draft.keepers.map((k) => k.pid)]),
    [draft],
  );
  const candidates = useMemo(() => {
    const t = name.toLowerCase();
    return t ? players.filter((p) => !taken.has(p.pid) && p.name.toLowerCase().includes(t)).slice(0, 8) : [];
  }, [name, players, taken]);
  const exact = candidates.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? (candidates.length === 1 ? candidates[0] : undefined);

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card} data-testid="keepers-panel">
        <h2>Keepers</h2>
        <p className={styles.hint}>
          Max 2 per team, one per round; the pick must still be theirs. A declared keeper leaves the pool and
          holds its board slot immediately — the same checks a trade gets, enforced by the database.
        </p>
        <div className={styles.list}>
          {draft.keepers.length === 0 && <p className={styles.hint}>None declared yet.</p>}
          {draft.keepers.map((k) => {
            const ov = overallFor(config, k.slot, k.round);
            const onBoard = draft.picks.some((p) => p.pid === k.pid && p.is_keeper);
            return (
              <div key={k.pid} className={styles.row} data-testid={`keeper-${k.pid}`}>
                <span>
                  🔒 <b>{byPid.get(k.pid)?.name ?? k.pid}</b>
                  <small>
                    {' '}
                    {teamName(k.slot)} · R{k.round} · #{ov}
                    {onBoard ? ' · on the board' : ''}
                  </small>
                </span>
                <button
                  data-testid={`unkeep-${k.pid}`}
                  disabled={onBoard}
                  title={onBoard ? 'Already applied — undo the pick instead' : 'Remove this keeper'}
                  onClick={() => act('keeper_removed', { pid: k.pid })}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!exact || !round) return;
            act('keeper_declared', { pid: exact.pid, slot, round: Number(round) });
            setName('');
            setRound('');
          }}
        >
          <h3>Declare a keeper</h3>
          <input
            data-testid="keeper-name"
            placeholder="Player…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            list="keeper-candidates"
          />
          <datalist id="keeper-candidates">
            {candidates.map((p) => (
              <option key={p.pid} value={p.name} />
            ))}
          </datalist>
          <select data-testid="keeper-slot" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {Array.from({ length: config.teams }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {teamName(i + 1)}
              </option>
            ))}
          </select>
          <input
            data-testid="keeper-round"
            type="number"
            min={1}
            max={config.rounds}
            placeholder="Rd"
            value={round}
            onChange={(e) => setRound(e.target.value)}
          />
          <button data-testid="keeper-add" type="submit" disabled={!exact || !round}>
            🔒 Add
          </button>
        </form>
        <div className={styles.actions}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
