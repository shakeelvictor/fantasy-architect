import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DraftState } from '@fa/rules';
import type { PoolPlayer } from '../api';
import { moveQueued, toggleQueued, useQueue } from '../queue';
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
  const [view, setView] = useState<'all' | 'queue'>('all');
  const queue = useQueue();

  const gone = useMemo(() => new Map(draft.picks.map((p) => [p.pid, p.slot])), [draft.picks]);
  const kept = useMemo(() => new Set(draft.keepers.map((k) => k.pid)), [draft.keepers]);
  const asked = useMemo(
    () => new Set(draft.requests.filter((r) => !r.resolved).map((r) => r.pid)),
    [draft.requests],
  );
  const byPid = useMemo(() => new Map(players.map((p) => [p.pid, p])), [players]);

  // drafted/kept players drop off the queue VIEW but stay stored (undo restores)
  const visibleQueue = useMemo(
    () => queue.filter((pid) => byPid.has(pid) && !gone.has(pid) && !kept.has(pid)),
    [queue, byPid, gone, kept],
  );

  const rows = useMemo(() => {
    const base = view === 'queue' ? visibleQueue.map((pid) => byPid.get(pid)!) : players;
    const t = term.toLowerCase();
    return t ? base.filter((p) => p.name.toLowerCase().includes(t)) : base;
  }, [players, term, view, visibleQueue, byPid]);

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
        <div className={styles.views}>
          <button
            data-testid="view-all"
            className={view === 'all' ? styles.viewActive : ''}
            onClick={() => setView('all')}
          >
            All
          </button>
          <button
            data-testid="view-queue"
            className={view === 'queue' ? styles.viewActive : ''}
            onClick={() => setView('queue')}
          >
            ★ Queue{visibleQueue.length ? ` (${visibleQueue.length})` : ''}
          </button>
        </div>
      </div>
      <div ref={parent} className={styles.scroller}>
        {view === 'queue' && rows.length === 0 && (
          <p className={styles.emptyQueue}>
            Your queue is empty — tap the ☆ on any player. It keeps your order, stays on this browser
            only, and drafted players drop off it.
          </p>
        )}
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((row) => {
            const p = rows[row.index]!;
            const takenBy = gone.get(p.pid);
            const isKept = kept.has(p.pid);
            const unavailable = takenBy !== undefined || isKept;
            const queued = queue.includes(p.pid);
            return (
              <div
                key={p.pid}
                data-testid={`row-${p.pid}`}
                className={`${styles.row} ${unavailable ? styles.gone : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${row.start}px)`, height: 44 }}
              >
                {view === 'queue' ? (
                  <span className={styles.mv}>
                    <span className={`${styles.rank} num`}>{row.index + 1}</span>
                    <button data-testid={`qup-${p.pid}`} title="Move up the queue" onClick={() => moveQueued(p.pid, -1, visibleQueue)}>▲</button>
                    <button data-testid={`qdn-${p.pid}`} title="Move down the queue" onClick={() => moveQueued(p.pid, 1, visibleQueue)}>▼</button>
                  </span>
                ) : (
                  <span className={`${styles.rank} num`}>{row.index + 1}</span>
                )}
                {!unavailable ? (
                  <button
                    data-testid={`star-${p.pid}`}
                    className={`${styles.star} ${queued ? styles.starOn : ''}`}
                    title={queued ? 'Remove from your queue' : 'Add to your queue'}
                    onClick={() => toggleQueued(p.pid)}
                  >
                    {queued ? '★' : '☆'}
                  </button>
                ) : (
                  <span className={styles.starGap} />
                )}
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
