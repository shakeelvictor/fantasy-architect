// Sleepers & Busts, v1's POSITIONAL rule: market rank within a position
// (from ADP) minus our rank within the position — never overall vs overall,
// which the forced K/IDP slots would swamp.

import { useMemo, useState } from 'react';
import type { DraftState } from '@fa/rules';
import type { PoolPlayer } from '../api';
import { headshot } from '../v1logic';

const POS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'IDP'] as const;

export function Values({ players, draft, onOpen }: {
  players: PoolPlayer[]; draft: DraftState; onOpen?: (pid: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<'sleepers' | 'busts'>('sleepers');
  const [pos, setPos] = useState<(typeof POS)[number]>('ALL');
  const gone = useMemo(() => new Set(draft.picks.map((p) => p.pid)), [draft.picks]);

  const rows = useMemo(() => {
    // market rank within each position group, from ADP
    const byGroup = new Map<string, PoolPlayer[]>();
    for (const p of players) {
      if (p.adp == null) continue;
      const g = byGroup.get(p.group) ?? [];
      g.push(p);
      byGroup.set(p.group, g);
    }
    const marketRank = new Map<string, number>();
    for (const list of byGroup.values()) {
      [...list].sort((a, b) => a.adp! - b.adp!).forEach((p, i) => marketRank.set(p.pid, i + 1));
    }
    const scored = players
      .filter((p) => marketRank.has(p.pid) && p.posRank != null && !gone.has(p.pid))
      .map((p) => ({ p, gap: marketRank.get(p.pid)! - p.posRank! }))
      .filter((x) => (view === 'sleepers' ? x.gap >= 8 : x.gap <= -8))
      .filter((x) => (pos === 'ALL' ? true : pos === 'IDP' ? x.p.group === 'IDP' : x.p.pos === pos));
    scored.sort((a, b) => (view === 'sleepers' ? b.gap - a.gap : a.gap - b.gap));
    return scored.slice(0, 40).map((x) => ({ ...x, market: marketRank.get(x.p.pid)! }));
  }, [players, view, pos, gone]);

  return (
    <div className="news-layout">
      <div className="card news-col">
        <div className="values-head">
          <h3 id="values-title">{view === 'sleepers' ? 'Sleepers' : 'Overpriced'}</h3>
          <div className="pos-tabs" id="values-switch">
            <button className={view === 'sleepers' ? 'active' : ''} onClick={() => setView('sleepers')}>💎 Sleepers</button>
            <button className={view === 'busts' ? 'active' : ''} onClick={() => setView('busts')}>⚠️ Overpriced</button>
          </div>
        </div>
        <p className="p-meta" id="values-blurb">
          {view === 'sleepers'
            ? 'The market takes them later within their position than our scoring says it should.'
            : 'The market takes them earlier within their position than our scoring supports.'}
        </p>
        <div className="pos-tabs values-pos" id="values-pos">
          {POS.map((t) => (
            <button key={t} data-vpos={t} className={pos === t ? 'active' : ''} onClick={() => setPos(t)}>
              {t === 'ALL' ? 'All' : t}
            </button>
          ))}
        </div>
        <div id="values-list">
          {rows.map(({ p, gap, market }) => (
            <div key={p.pid} className="rec-item" data-pid={p.pid} onClick={() => onOpen?.(p.pid)}>
              <img className="mini-shot" loading="lazy" src={headshot(p.pid)} alt=""
                onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
              <span className={`pos-pill pos-${p.pos}`}>{p.pos}</span>
              <div className="rec-main">
                <div className="rec-name">{p.name}</div>
                <div className="rec-why">
                  market {p.pos}{market} · our board {p.pos}{p.posRank} · {p.proj.toFixed(0)} pts · ADP {p.adp!.toFixed(0)}
                </div>
              </div>
              <span className="rec-pts" style={{ color: gap > 0 ? 'var(--accent-text, #00ceb8)' : 'var(--danger, #ff5c5c)' }}>
                {gap > 0 ? `+${gap}` : gap}
              </span>
            </div>
          ))}
          {!rows.length && <p className="p-meta">Nothing meets the ±8-slot bar right now.</p>}
        </div>
      </div>
    </div>
  );
}
