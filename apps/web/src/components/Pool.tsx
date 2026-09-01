import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DraftState } from '@fa/rules';
import type { PoolPlayer } from '../api';
import { moveQueued, toggleQueued, useQueue } from '../queue';
import styles from './pool.module.css';

const TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'IDP'] as const;
type Tab = (typeof TABS)[number];

export const headshot = (pid: string): string =>
  `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;

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
  const [tab, setTab] = useState<Tab>('ALL');
  const [view, setView] = useState<'all' | 'queue'>('all');
  const queue = useQueue();

  const gone = useMemo(() => new Map(draft.picks.map((p) => [p.pid, p.slot])), [draft.picks]);
  const kept = useMemo(() => new Set(draft.keepers.map((k) => k.pid)), [draft.keepers]);
  const asked = useMemo(
    () => new Set(draft.requests.filter((r) => !r.resolved).map((r) => r.pid)),
    [draft.requests],
  );
  const byPid = useMemo(() => new Map(players.map((p) => [p.pid, p])), [players]);

  // drafted / draftable per tab — draftable = above replacement (vorp > 0),
  // numerator counts PICKS only, and the predicate is the tab's own:
  // IDP matches the group, everything else the exact position (v1's rules)
  const counts = useMemo(() => {
    const out = {} as Record<Tab, { taken: number; total: number }>;
    for (const t of TABS) out[t] = { taken: 0, total: 0 };
    for (const p of players) {
      if (!((p.vorp ?? 0) > 0)) continue;
      const key = (p.group === 'IDP' ? 'IDP' : p.pos) as Tab;
      const taken = gone.has(p.pid) ? 1 : 0;
      if (out[key]) {
        out[key].total++;
        out[key].taken += taken;
      }
      out.ALL.total++;
      out.ALL.taken += taken;
    }
    return out;
  }, [players, gone]);

  const visibleQueue = useMemo(
    () => queue.filter((pid) => byPid.has(pid) && !gone.has(pid) && !kept.has(pid)),
    [queue, byPid, gone, kept],
  );

  const rows = useMemo(() => {
    let base = view === 'queue' ? visibleQueue.map((pid) => byPid.get(pid)!) : players;
    if (view !== 'queue' && tab !== 'ALL') {
      base = base.filter((p) => (tab === 'IDP' ? p.group === 'IDP' : p.pos === tab));
    }
    const t = term.toLowerCase();
    return t ? base.filter((p) => p.name.toLowerCase().includes(t)) : base;
  }, [players, term, tab, view, visibleQueue, byPid]);

  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 48,
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
        <div className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t}
              data-testid={`pos-${t}`}
              className={view === 'all' && tab === t ? styles.tabActive : ''}
              onClick={() => {
                setTab(t);
                setView('all');
              }}
            >
              {t === 'ALL' ? 'All' : t}
              <span className={`${styles.count} mono`}>
                {counts[t].taken}/{counts[t].total}
              </span>
            </button>
          ))}
          <button
            data-testid="view-queue"
            className={view === 'queue' ? styles.tabActive : ''}
            onClick={() => setView('queue')}
          >
            ★ Queue{visibleQueue.length ? ` (${visibleQueue.length})` : ''}
          </button>
          <button data-testid="view-all" hidden onClick={() => setView('all')} />
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
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${row.start}px)`, height: 48 }}
              >
                {view === 'queue' ? (
                  <span className={styles.mv}>
                    <span className={`${styles.rank} mono`}>{row.index + 1}</span>
                    <button data-testid={`qup-${p.pid}`} title="Move up the queue" onClick={() => moveQueued(p.pid, -1, visibleQueue)}>▲</button>
                    <button data-testid={`qdn-${p.pid}`} title="Move down the queue" onClick={() => moveQueued(p.pid, 1, visibleQueue)}>▼</button>
                  </span>
                ) : (
                  <span className={`${styles.rank} mono`}>{row.index + 1}</span>
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
                <img className={styles.shot} loading="lazy" src={headshot(p.pid)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                <span className={`${styles.pill} ${styles[`g_${p.group}`] ?? ''}`}>{p.pos}</span>
                <span className={styles.name}>
                  <span className={styles.pname}>{p.name}</span>
                  <small>
                    {p.team ?? 'FA'} · {p.pos}
                    {p.posRank ?? ''} · ADP {p.adp ?? '—'}
                  </small>
                </span>
                {p.tier ? <span className={`${styles.tierChip} mono ${styles[`t_${(p.tier - 1) % 6}`]}`}>T{p.tier}</span> : <span className={styles.tierGap} />}
                <span className={`${styles.proj} mono`}>{p.proj.toFixed(0)}</span>
                {takenBy !== undefined ? (
                  <span className={styles.owner}>→ {teamName(takenBy)}</span>
                ) : isKept ? (
                  <span className={styles.owner}>🔒 keeper</span>
                ) : mode === 'commish' ? (
                  <button data-testid={`draft-${p.pid}`} className={styles.draftBtn} disabled={disabled} onClick={() => onDraft(p.pid)}>
                    Draft
                  </button>
                ) : (
                  <button data-testid={`ask-${p.pid}`} className={styles.draftBtn} disabled={disabled || asked.has(p.pid)} onClick={() => onAsk(p.pid)}>
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
