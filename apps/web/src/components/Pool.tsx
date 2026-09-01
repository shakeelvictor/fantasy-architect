// v1's pool panel, verbatim DOM over v2 state: position tabs with
// drafted/draftable counts, 💎 Sleepers, column views (League value / '26
// projections), the three-tap sort cycle with chips + mobile dropdown, tier
// dividers, the next-pick divider, the queue, and the full table.

import { useMemo, useState } from 'react';
import type { DraftState, SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import {
  headshot, isSleeper, myNextPickOverall, myPickAfterNext,
  SORT_DEFAULT_DIR, sortValue, sosClass, STAT_COLS,
} from '../v1logic';
import { moveQueued, toggleQueued, useQueue } from '../queue';

const POS_TABS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'IDP', 'SLEEPERS'] as const;
type PosTab = (typeof POS_TABS)[number];
type Sort = { key: string; dir: 'asc' | 'desc' } | null;

interface Props {
  players: PoolPlayer[];
  draft: DraftState;
  config: SeasonConfig;
  teamName: (slot: number) => string;
  mode: 'commish' | 'team';
  mySlot: number;
  disabled: boolean;
  onDraft: (pid: string) => void;
  onAsk: (pid: string) => void;
  onOpen?: (pid: string) => void;
}

export function Pool({ players, draft, config, teamName, mode, mySlot, disabled, onDraft, onAsk, onOpen }: Props): React.JSX.Element {
  const [term, setTerm] = useState('');
  const [posFilter, setPosFilter] = useState<PosTab>('ALL');
  const [colView, setColView] = useState<'value' | 'stats'>(
    () => (localStorage.getItem('fa-colview') === 'stats' ? 'stats' : 'value'),
  );
  const [sort, setSortState] = useState<Sort>(null);
  const [sortPrev, setSortPrev] = useState<Sort>(null);
  const [hideDrafted, setHideDrafted] = useState(true);
  const [queueMode, setQueueMode] = useState(false);
  const queue = useQueue();

  const setSort = (next: Sort): void => {
    setSortPrev(sort);
    setSortState(next);
  };

  const rankByPid = useMemo(() => new Map(players.map((p, i) => [p.pid, i + 1])), [players]);
  const gone = useMemo(() => new Map(draft.picks.map((p) => [p.pid, p])), [draft.picks]);
  const keeperByPid = useMemo(() => new Map(draft.keepers.map((k) => [k.pid, k])), [draft.keepers]);
  const asked = useMemo(
    () => new Set(draft.requests.filter((r) => !r.resolved).map((r) => r.pid)),
    [draft.requests],
  );
  const byPid = useMemo(() => new Map(players.map((p) => [p.pid, p])), [players]);

  const counts = useMemo(() => {
    const out: Record<string, { taken: number; total: number }> = {};
    for (const t of POS_TABS) out[t] = { taken: 0, total: 0 };
    for (const p of players) {
      if (!((p.vorp ?? 0) > 0)) continue;
      const key = p.group === 'IDP' ? 'IDP' : p.pos;
      const taken = gone.has(p.pid) ? 1 : 0;
      if (out[key]) { out[key]!.total++; out[key]!.taken += taken; }
      out.ALL!.total++;
      out.ALL!.taken += taken;
    }
    return out;
  }, [players, gone]);

  const visibleQueue = useMemo(
    () => queue.filter((pid) => byPid.has(pid) && !gone.has(pid) && !keeperByPid.has(pid)),
    [queue, byPid, gone, keeperByPid],
  );

  const rows = useMemo(() => {
    let base: PoolPlayer[];
    if (queueMode) {
      base = visibleQueue.map((pid) => byPid.get(pid)!);
    } else {
      base = players;
      if (posFilter === 'SLEEPERS') base = base.filter((p) => isSleeper(p, rankByPid.get(p.pid)!));
      else if (posFilter !== 'ALL') base = base.filter((p) => (posFilter === 'IDP' ? p.group === 'IDP' : p.pos === posFilter));
      if (hideDrafted) base = base.filter((p) => !gone.has(p.pid));
      if (sort) {
        const dir = sort.dir === 'desc' ? -1 : 1;
        base = [...base].sort((a, b) => {
          const va = sortValue(a, rankByPid.get(a.pid)!, sort.key);
          const vb = sortValue(b, rankByPid.get(b.pid)!, sort.key);
          if (va == null && vb == null) return rankByPid.get(a.pid)! - rankByPid.get(b.pid)!;
          if (va == null) return 1;
          if (vb == null) return -1;
          return (va - vb) * dir || rankByPid.get(a.pid)! - rankByPid.get(b.pid)!;
        });
      }
    }
    const t = term.toLowerCase();
    if (t) base = base.filter((p) => p.name.toLowerCase().includes(t) || (p.team ?? '').toLowerCase() === t);
    return base.slice(0, 250);
  }, [players, term, posFilter, hideDrafted, sort, queueMode, visibleQueue, byPid, gone, rankByPid]);

  const statCols = STAT_COLS[posFilter === 'SLEEPERS' || queueMode ? 'ALL' : posFilter] ?? STAT_COLS.ALL!;
  const statsMode = colView === 'stats';
  const COLS = statsMode ? statCols.length + 4 : 10;

  // dividers, v1's rules: tiers on a single position in board order; the
  // next-pick line on ALL in board order only
  const showTierDividers = !queueMode && !['ALL', 'SLEEPERS'].includes(posFilter) && !term && !sort;
  const cur = draft.picks.length + 1;
  const next = myNextPickOverall(config, draft, mySlot);
  const after = myPickAfterNext(config, draft, mySlot);
  let nextPickAt: number | null = null;
  if (!queueMode && posFilter === 'ALL' && !term && !sort && draft.started && !draft.completed && next != null) {
    const dueKeepers = draft.keepers.filter((k) => {
      const ov = (k.round - 1) * config.teams + k.slot;
      return ov >= cur && ov < next && !gone.has(k.pid);
    }).length;
    nextPickAt = next - cur - dueKeepers;
  }

  let lastTier: number | null = null;
  let dividedRest = false;
  let availSeen = 0;
  let nextPickEmitted = false;

  const cycleSort = (key: string): void => {
    const dflt = SORT_DEFAULT_DIR[key] ?? (key.startsWith('s:') ? 'desc' : 'asc');
    if (!sort || sort.key !== key) setSort({ key, dir: dflt });
    else if (sort.dir === dflt) setSort({ key, dir: dflt === 'asc' ? 'desc' : 'asc' });
    else setSort(null);
  };
  const th = (key: string, label: string, title?: string): React.JSX.Element => (
    <th
      key={key}
      className={`num sortable ${sort?.key === key ? (sort.dir === 'desc' ? 'sorted-desc' : 'sorted-asc') : ''}`}
      data-sort={key}
      title={title}
      onClick={() => cycleSort(key)}
    >
      {label}
    </th>
  );

  const sortLabel: Record<string, string> = { rk: 'Rk', proj: 'Proj', adp: 'ADP', bye: 'Bye', sos: 'SOS', po: 'PO', int: 'Int' };

  return (
    <div className="pool-panel">
      <div className="pool-controls">
        <input
          type="search"
          id="search"
          data-testid="pool-search"
          placeholder="Search players…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="pos-tabs" id="pos-tabs">
          {POS_TABS.map((t) => (
            <button
              key={t}
              data-pos={t}
              data-testid={`pos-${t}`}
              className={!queueMode && posFilter === t ? 'active' : ''}
              title={t === 'SLEEPERS' ? 'Late-ADP players our scoring ranks well ahead of their price' : undefined}
              onClick={() => {
                setPosFilter(t);
                setQueueMode(false);
              }}
            >
              {t === 'ALL' ? 'All' : t === 'SLEEPERS' ? '💎 Sleepers' : t}
              {t !== 'SLEEPERS' && (
                <span className="tab-count"> {counts[t]!.taken}/{counts[t]!.total}</span>
              )}
            </button>
          ))}
        </div>
        <select
          id="col-view"
          className="col-view"
          title="Which columns to show"
          value={colView}
          onChange={(e) => {
            const v = e.target.value === 'stats' ? 'stats' : 'value';
            setColView(v);
            localStorage.setItem('fa-colview', v);
            if (sort?.key.startsWith('s:') && v === 'value') setSort(null);
          }}
        >
          <option value="value">League value</option>
          <option value="stats">'26 projections</option>
        </select>
        {sort && (
          <button
            className="btn sort-chip"
            id="sort-reset"
            title="Clear this sort and go back to board order"
            onClick={() => {
              setSortState(null);
              setSortPrev(null);
              void sortPrev;
            }}
          >
            ✕ {sortLabel[sort.key] ?? statCols.find(([k]) => `s:${k}` === sort.key)?.[1] ?? sort.key}
            {sort.dir === 'desc' ? ' ↓' : ' ↑'}
          </button>
        )}
        <button
          className={`btn sort-chip ${queueMode ? 'active' : ''}`}
          id="myboard-btn"
          data-testid="view-queue"
          title="Your queue — star players onto it, draft straight off it"
          onClick={() => setQueueMode(!queueMode)}
        >
          ★ Queue{visibleQueue.length ? ` (${visibleQueue.length})` : ''}
        </button>
        <span className="sort-mobile">
          <select
            id="sort-select"
            title="Sort by"
            value={sort && sortLabel[sort.key] ? sort.key : ''}
            onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: SORT_DEFAULT_DIR[e.target.value] ?? 'asc' } : null)}
          >
            <option value="">Sort: board</option>
            <option value="proj">Sort: Proj</option>
            <option value="adp">Sort: ADP</option>
            <option value="int">Sort: Interest</option>
            <option value="bye">Sort: Bye</option>
            <option value="sos">Sort: SOS</option>
            <option value="po">Sort: PO</option>
          </select>
          <button className="btn sort-chip" id="sort-dir" title="Flip sort direction"
            onClick={() => sort && setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}>
            {sort ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
          </button>
        </span>
        <label className="chk">
          <input type="checkbox" checked={hideDrafted} onChange={(e) => setHideDrafted(e.target.checked)} /> Hide drafted
        </label>
      </div>
      <div className="pool-table-wrap">
        <table className={`pool-table ${statsMode ? 'stats-view' : ''}`}>
          <thead>
            <tr id="pool-head-row">
              {th('rk', 'Rk', 'Our board — value over replacement. Click any column to sort')}
              <th>Player</th>
              {th('proj', 'Proj', 'Custom projected season points')}
              {statsMode
                ? statCols.map(([k, label]) => th(`s:${k}`, label))
                : [
                    <th key="pt" className="num" title="Position rank and value tier">Pos · Tier</th>,
                    th('adp', 'ADP', 'Sleeper ADP for IDP 1-QB formats'),
                    th('bye', 'Bye'),
                    th('sos', 'SOS', 'Strength of schedule wks 1–14. 1 = easiest, 32 = hardest'),
                    th('po', 'PO', 'Playoff SOS, weeks 15–17'),
                    th('int', 'Int', "Sleeper interest — Sleeper's own popularity rank"),
                  ]}
              <th></th>
            </tr>
          </thead>
          <tbody id="pool-body">
            {queueMode && rows.length === 0 && (
              <tr><td colSpan={COLS} className="p-meta" style={{ padding: 14 }}>
                Your queue is empty — tap the ☆ on any player to add him. It keeps your order and drafted players drop off it.
              </td></tr>
            )}
            {rows.map((p, i) => {
              const rank = rankByPid.get(p.pid)!;
              const pk = gone.get(p.pid);
              const keeper = keeperByPid.get(p.pid);
              const isGone = !!pk;
              const atRisk = !isGone && p.adp != null && after != null && p.adp <= after;
              const dividers: React.JSX.Element[] = [];
              if (showTierDividers) {
                if (p.tier && p.tier !== lastTier) {
                  dividers.push(<tr key={`t${p.tier}`} className="tier-divider"><td colSpan={COLS}>Tier {p.tier}</td></tr>);
                  lastTier = p.tier;
                } else if (!p.tier && !dividedRest && lastTier != null) {
                  dividers.push(<tr key="rest" className="tier-divider"><td colSpan={COLS}>The rest</td></tr>);
                  dividedRest = true;
                }
              }
              if (nextPickAt != null && !nextPickEmitted && !isGone && !keeper) {
                if (availSeen === nextPickAt) {
                  const r = Math.floor((next! - 1) / config.teams) + 1;
                  const pir = ((next! - 1) % config.teams) + 1;
                  dividers.push(
                    <tr key="np" className="tier-divider next-pick-divider"><td colSpan={COLS}>
                      {next === cur
                        ? `🎯 You're on the clock — pick #${next}`
                        : `🎯 Your next pick — #${next} (R${r}.${String(pir).padStart(2, '0')}, ${next! - cur} picks away)`}
                    </td></tr>,
                  );
                  nextPickEmitted = true;
                }
                availSeen++;
              }
              const gem = !isGone && isSleeper(p, rank);
              const queued = queue.includes(p.pid);
              return (
                <FragmentRow key={p.pid} dividers={dividers}>
                  <tr
                    data-pid={p.pid}
                    data-testid={`row-${p.pid}`}
                    className={`${isGone ? 'drafted' : ''} ${atRisk ? 'risk' : ''}`}
                    onClick={() => onOpen?.(p.pid)}
                  >
                    <td className="num">{queueMode ? i + 1 : rank}</td>
                    <td>
                      <div className="player-cell">
                        {!isGone && !keeper ? (
                          <button
                            className={`star${queued ? ' on' : ''}`}
                            data-testid={`star-${p.pid}`}
                            title={queued ? 'Remove from your queue' : 'Add to your queue'}
                            onClick={(e) => { e.stopPropagation(); toggleQueued(p.pid); }}
                          >
                            {queued ? '★' : '☆'}
                          </button>
                        ) : (
                          <span className="star-gap" />
                        )}
                        {queueMode && (
                          <span className="mv-ctl" onClick={(e) => e.stopPropagation()}>
                            <button className="mv" data-testid={`qup-${p.pid}`} onClick={() => moveQueued(p.pid, -1, visibleQueue)}>▲</button>
                            <button className="mv" data-testid={`qdn-${p.pid}`} onClick={() => moveQueued(p.pid, 1, visibleQueue)}>▼</button>
                          </span>
                        )}
                        <img className="mini-shot" loading="lazy" src={headshot(p.pid)} alt=""
                          onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                        <span className={`pos-pill pos-${p.pos}`}>{p.pos}</span>
                        <div>
                          <div className="p-name">
                            {p.name}
                            {p.injury && <span className="inj">{p.injury.slice(0, 4).toUpperCase()}</span>}
                            {gem && (
                              <span className="sleeper-badge" title={`Sleeper: room takes him at ${p.adp!.toFixed(0)}, our board says #${rank}`}>💎</span>
                            )}
                          </div>
                          <div className="p-meta">
                            {p.team ?? 'FA'} · {p.pos}{p.posRank}
                            <span className="meta-adp"> · ADP {p.adp != null ? p.adp.toFixed(0) : '—'}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num"><b>{p.proj.toFixed(1)}</b></td>
                    {statsMode
                      ? statCols.map(([k]) => (
                          <td key={k} className="num">{p.stats?.[k] != null ? p.stats[k] : '—'}</td>
                        ))
                      : [
                          <td key="pt" className="num">
                            {p.pos}{p.posRank}
                            {p.tier ? <span className={`tier-chip t-${(p.tier - 1) % 6}`}> T{p.tier}</span> : ''}
                          </td>,
                          <td key="adp" className="num">{p.adp != null ? p.adp.toFixed(1) : '—'}</td>,
                          <td key="bye" className="num">{p.bye ?? '—'}</td>,
                          <td key="sos" className={`num ${sosClass(p.sos)}`}>{p.sos != null ? p.sos.toFixed(0) : '—'}</td>,
                          <td key="po" className={`num ${sosClass(p.po)}`}>{p.po != null ? p.po.toFixed(0) : '—'}</td>,
                          <td key="int" className="num">{p.interest ?? '—'}</td>,
                        ]}
                    <td onClick={(e) => e.stopPropagation()}>
                      {pk ? (
                        <span className="drafted-by" title={`#${pk.overall} overall`}>
                          {pk.is_keeper ? '🔒 ' : ''}→ {teamName(pk.slot)}
                        </span>
                      ) : keeper ? (
                        <span className="keeper-tag">🔒 R{keeper.round}</span>
                      ) : mode === 'commish' ? (
                        <button className="draft-btn" data-testid={`draft-${p.pid}`} disabled={disabled} onClick={() => onDraft(p.pid)}>
                          Draft
                        </button>
                      ) : (
                        <button
                          className={`draft-btn${asked.has(p.pid) ? ' is-asked' : ''}`}
                          data-testid={`ask-${p.pid}`}
                          disabled={disabled || asked.has(p.pid)}
                          onClick={() => onAsk(p.pid)}
                        >
                          {asked.has(p.pid) ? 'Asked' : 'Ask'}
                        </button>
                      )}
                    </td>
                  </tr>
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ dividers, children }: { dividers: React.JSX.Element[]; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      {dividers}
      {children}
    </>
  );
}
