import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DraftState } from '@fa/rules';
import type { PoolPlayer } from '../api';
import styles from './pool.module.css';

interface Props {
  players: PoolPlayer[];
  draft: DraftState;
  teamName: (slot: number) => string;
  mode: 'commish' | 'team';
  disabled: boolean;
  onDraft: (pid: string) => void;
  onAsk: (pid: string) => void;
}

export function Pool({ players, draft, teamName, mode, disabled, onDraft, onAsk }: Props): React.JSX.Element {
  const [term, setTerm] = useState('');
  const gone = useMemo(() => new Map(draft.picks.map((p) => [p.pid, p.slot])), [draft.picks]);
  const kept = useMemo(() => new Set(draft.keepers.map((k) => k.pid)), [draft.keepers]);
  const asked = useMemo(
    () => new Set(draft.requests.filter((r) => !r.resolved).map((r) => r.pid)),
    [draft.requests],
  );

  const rows = useMemo(() => {
    const t = term.toLowerCase();
    return t ? players.filter((p) => p.name.toLowerCase().includes(t)) : players;
  }, [players, term]);

  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  return (
    <section className={styles.pool}>
      <div className={styles.controls}>
        <input
          data-testid="pool-search"
          type="search"
          placeholder={`Search ${players.length} players…`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <div ref={parent} className={styles.scroller}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((row) => {
            const p = rows[row.index]!;
            const takenBy = gone.get(p.pid);
            const isKept = kept.has(p.pid);
            const unavailable = takenBy !== undefined || isKept;
            return (
              <div
                key={p.pid}
                data-testid={`row-${p.pid}`}
                className={`${styles.row} ${unavailable ? styles.gone : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${row.start}px)`, height: 44 }}
              >
                <span className={`${styles.rank} num`}>{row.index + 1}</span>
                <span className={`${styles.pos} ${styles[`g_${p.group}`] ?? ''}`}>{p.pos}</span>
                <span className={styles.name}>
                  {p.name}
                  <small>
                    {p.team ?? 'FA'} · ADP {p.adp ?? '—'}
                  </small>
                </span>
                <span className={`${styles.proj} num`}>{p.proj.toFixed(0)}</span>
                {takenBy !== undefined ? (
                  <span className={styles.owner}>→ {teamName(takenBy)}</span>
                ) : isKept ? (
                  <span className={styles.owner}>🔒 keeper</span>
                ) : mode === 'commish' ? (
                  <button data-testid={`draft-${p.pid}`} disabled={disabled} onClick={() => onDraft(p.pid)}>
                    Draft
                  </button>
                ) : (
                  <button data-testid={`ask-${p.pid}`} disabled={disabled || asked.has(p.pid)} onClick={() => onAsk(p.pid)}>
                    {asked.has(p.pid) ? 'Asked' : 'Ask'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
