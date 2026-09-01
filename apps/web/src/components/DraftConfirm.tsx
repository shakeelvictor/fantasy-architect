// v1's confirm-before-draft card (confirmDraft), verbatim DOM: the position-
// colored modal quoting exactly the pick the board is showing — team logo,
// headshot, pick coordinates, who it lands with. The guard belongs on the
// three HUMAN buttons (pool row, top suggestion, drawer) — bots, Ask/Take-it
// and redo never see it (v1's rule, kept). Single-flight by construction:
// one confirmPid in Room means a newer ask replaces the old one.

import { useEffect, useRef } from 'react';
import { currentOverall, ownerOf, roundOf, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import { headshot, teamLogo } from '../profile';

interface Props {
  p: PoolPlayer;
  config: SeasonConfig;
  draft: DraftState;
  teamName: (slot: number) => string;
  mySlot: number;
  isMock: boolean;
  onAnswer: (ok: boolean) => void;
}

export function DraftConfirm({ p, config, draft, teamName, mySlot, isMock, onAnswer }: Props): React.JSX.Element {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onAnswer(false);
      if (e.key === 'Enter') onAnswer(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pid]);

  // the pick quoted is whatever the board is showing right now
  const overall = currentOverall(draft);
  const round = roundOf(config, overall);
  const pir = ((overall - 1) % config.teams) + 1;
  const owner = ownerOf(config, draft, overall);
  const mine = owner === mySlot;

  return (
    <div
      id="draft-confirm"
      className={`modal dconf-modal g-${p.group}`}
      onClick={(e) => { if (e.target === e.currentTarget) onAnswer(false); }}
    >
      <div className="dconf-card">
        {p.team && <img className="dconf-logo" src={teamLogo(p.team)} alt=""
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
        <img className="dconf-shot" src={headshot(p.pid)} alt=""
          onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        <div className="dconf-body">
          <div className="dconf-label">Pick {round}.{String(pir).padStart(2, '0')} · #{overall} overall</div>
          <div className="dconf-name">{p.name}</div>
          <div className="dconf-sub">
            <span className={`pos-pill pos-${p.pos}`}>{p.pos}</span>{' '}
            {p.team ?? 'FA'} → <b>{teamName(owner)}{mine ? ' (you)' : ''}</b>
            <span className="dconf-pts">{p.proj.toFixed(0)} pts</span>
          </div>
          {isMock && <div className="dconf-mock">Mock draft</div>}
          <div className="dconf-actions">
            <button className="btn" data-dconf="cancel" data-testid="dconf-cancel" onClick={() => onAnswer(false)}>
              Cancel
            </button>
            <button className="btn primary" data-dconf="ok" data-testid="dconf-ok" ref={okRef} onClick={() => onAnswer(true)}>
              Draft {p.name.split(' ').slice(-1)[0]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
