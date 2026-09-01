// v1's live pick ticker: the last few picks scroll under the header, with
// who's on the clock leading the loop. Rendered as one HTML string doubled
// for a seamless marquee, and only rewritten when it actually changes so a
// re-render never restarts the animation mid-scroll (v1's rule, kept by
// memoizing the markup and letting React skip identical DOM).

import { useMemo } from 'react';
import { currentOverall, ownerOf, roundOf, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad2 = (n: number): string => String(n).padStart(2, '0');

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  mySlot: number;
  done: boolean;
}

export function Ticker({ config, draft, byPid, teamName, mySlot, done }: Props): React.JSX.Element | null {
  const recent = draft.picks.slice(-10).reverse();

  const { html, duration } = useMemo(() => {
    const items: string[] = [];
    if (!done) {
      const overall = currentOverall(draft);
      const round = roundOf(config, overall);
      const pir = ((overall - 1) % config.teams) + 1;
      const owner = ownerOf(config, draft, overall);
      const me = owner === mySlot;
      items.push(`<span class="tk tk-clock">▲ ${me ? 'YOU ARE' : `${esc(teamName(owner).toUpperCase())} IS`} ON THE CLOCK — PICK ${round}.${pad2(pir)}</span>`);
    }
    for (const pk of recent) {
      const p = byPid.get(pk.pid);
      const pir = ((pk.overall - 1) % config.teams) + 1;
      items.push(`<span class="tk">⬤ ${pk.round}.${pad2(pir)} ${esc(teamName(pk.slot).toUpperCase())} → ${esc((p?.name ?? pk.pid).toUpperCase())} <span class="tk-pos">${esc(p?.pos ?? '')}</span></span>`);
    }
    const half = items.join('');
    // ~4.4s per item ≈ 55px/s — one steady, readable speed at any log length
    return { html: half + half, duration: `${(items.length * 4.4).toFixed(1)}s` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.picks.length, done, config, mySlot, byPid]);

  if (!recent.length) return null;

  return (
    <div id="pick-ticker" className="pick-ticker" aria-hidden="true">
      <div
        className="ticker-track"
        id="ticker-track"
        style={{ animationDuration: duration }}
        dangerouslySetInnerHTML={{ __html: html }}
      ></div>
    </div>
  );
}
