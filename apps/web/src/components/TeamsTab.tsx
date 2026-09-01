// v1's Teams tab: chips with counts, then the LINEUP — QB / 2 RB / 3 WR /
// TE / FLEX / 3 IDP / K / bench, keepers pending shown in their slots with
// the 🔒 R# chip, and the projected stat line under each name.

import { useState } from 'react';
import type { DraftState, SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import { headshot, pendingKeepersForSlot, rosterForSlot } from '../v1logic';

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  mySlot: number | null;
}

const STAT_LABELS: [string, string][] = [
  ['pass_yd', 'pass yds'], ['pass_td', 'pass td'], ['rush_yd', 'rush yds'], ['rush_td', 'rush td'],
  ['rec', 'rec'], ['rec_yd', 'rec yds'], ['rec_td', 'rec td'],
  ['idp_tkl_solo', 'solo'], ['idp_sack', 'sacks'], ['fgm_40_49', 'FG 40-49'], ['xpm', 'XP'],
];
function statLine(p: PoolPlayer): string {
  if (!p.stats) return '';
  const parts: string[] = [];
  for (const [k, label] of STAT_LABELS) {
    const v = p.stats[k];
    if (v && parts.length < 3) parts.push(`${Math.round(v)} ${label}`);
  }
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

export function TeamsTab({ config, draft, byPid, teamName, mySlot }: Props): React.JSX.Element {
  const [view, setView] = useState(mySlot ?? 1);
  const picked = rosterForSlot(byPid, draft, view);
  const pending = pendingKeepersForSlot(byPid, draft, view);
  const roster = [...picked, ...pending.map((x) => x.p)];
  const keeperRound = new Map(pending.map((x) => [x.p.pid, x.round]));
  const total = roster.reduce((a, p) => a + p.proj, 0);

  const slots: { label: string; p: PoolPlayer | null }[] = [];
  const pool = [...roster];
  const take = (g: string, n: number, label: string): void => {
    for (let i = 0; i < n; i++) {
      const idx = pool.findIndex((p) => p.group === g);
      slots.push({ label, p: idx >= 0 ? pool.splice(idx, 1)[0]! : null });
    }
  };
  take('QB', 1, 'QB');
  take('RB', 2, 'RB');
  take('WR', 3, 'WR');
  take('TE', 1, 'TE');
  const fIdx = pool.findIndex((p) => ['RB', 'WR', 'TE'].includes(p.group));
  slots.push({ label: 'FLEX', p: fIdx >= 0 ? pool.splice(fIdx, 1)[0]! : null });
  take('IDP', 3, 'IDP');
  take('K', 1, 'K');
  pool.forEach((p) => slots.push({ label: 'BN', p }));
  const bnEmpty = config.rounds - roster.length - slots.filter((s) => !s.p).length;
  for (let i = 0; i < Math.max(bnEmpty, 0) && slots.length < config.rounds; i++) slots.push({ label: 'BN', p: null });

  return (
    <div data-testid="teams-tab">
      <div className="pool-controls">
        <div className="pos-tabs" id="team-tabs">
          {Array.from({ length: config.teams }, (_, i) => i + 1).map((s) => (
            <button key={s} data-team={s} data-testid={`team-chip-${s}`} className={s === view ? 'active' : ''} onClick={() => setView(s)}>
              {teamName(s)}
              {s === mySlot ? <span className="p-meta"> (you)</span> : null}
              {' '}
              <span className="tab-count">
                {draft.picks.filter((p) => p.slot === s).length + pendingKeepersForSlot(byPid, draft, s).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="card" id="team-roster-card">
        <h3 id="team-roster-title">
          {teamName(view)} — {roster.length}/{config.rounds} players
          {pending.length ? ` · ${pending.length} keeper${pending.length === 1 ? '' : 's'} pending` : ''}
          {' '}· {total.toFixed(0)} projected pts
        </h3>
        <div id="team-roster" data-testid="team-roster">
          {slots.map((s, i) => (
            <div key={i} className="roster-slot" data-pid={s.p?.pid}>
              <span className="slot-label">{s.label}</span>
              {s.p ? (
                <>
                  <img className="mini-shot" loading="lazy" src={headshot(s.p.pid)} alt=""
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                  <span className={`pos-pill pos-${s.p.pos}`}>{s.p.pos}</span>
                  <span className="rs-main">
                    <span className="rs-name">
                      {s.p.name}
                      {keeperRound.has(s.p.pid) && <span className="keeper-tag"> 🔒 R{keeperRound.get(s.p.pid)}</span>}
                    </span>
                    <span className="rs-line">{s.p.team ?? 'FA'} · {s.p.pos}{s.p.posRank}{statLine(s.p)}</span>
                  </span>
                  <span className="rs-proj">{s.p.proj.toFixed(0)}<span className="rs-proj-l">PROJ</span></span>
                </>
              ) : (
                <span className="slot-empty">—</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
