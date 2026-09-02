// v1's side panel: util card (Undo / Redo / Keepers / Trades), Export card,
// Suggested Picks with the Top Suggestion spotlight, and the Draft Safety
// card — reshaped for the server-authoritative world: the event log IS the
// autosave, and the backup download is the whole log as JSON.

import type { DraftEvent, DraftState, SeasonConfig } from '@fa/rules';
import { SEASON, type PoolPlayer, type Session } from '../api';
import { suppressNextPickPop } from '../celebrate';
import { exportXlsx } from '../exports';
import { headshot, recommendations } from '../v1logic';

interface Props {
  players: PoolPlayer[];
  byPid: Map<string, PoolPlayer>;
  config: SeasonConfig;
  draft: DraftState;
  session: Session;
  mySlot: number;
  teamName: (slot: number) => string;
  done: boolean;
  onClock: boolean;
  act: (type: string, payload?: Record<string, unknown>) => void;
  events: DraftEvent[];
  openPanel: (p: 'keepers' | 'trades' | 'mfl') => void;
  onOpen?: (pid: string) => void;
  mock?: boolean;
  mockPanel?: React.ReactNode;
  redoPid?: string | null;
  onDraft?: (pid: string) => void;
}

export function SidePanel({ players, byPid, config, draft, session, mySlot, teamName, done, onClock, act, events, openPanel, onOpen, mock, mockPanel, redoPid, onDraft }: Props): React.JSX.Element {
  const isCommish = session.role === 'commish';
  const recs = done ? [] : recommendations(players, byPid, config, draft, mySlot, 8);
  const top = recs[0];

  const downloadBackup = (): void => {
    const blob = new Blob([JSON.stringify({ savedAt: new Date().toISOString(), config, events }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fa-draft-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <aside className="side-panel">
      {mockPanel}
      {(isCommish || mock) && (
        <div className="card" id="util-card">
          <div className="util-row">
            <button className="btn" data-testid="undo" disabled={!draft.started || draft.picks.length === 0 || done} onClick={() => act('pick_undone')}>
              Undo Pick
            </button>
            <button className="btn" data-testid="redo" disabled={!redoPid || !draft.started || done}
              title={redoPid ? 'Put back the pick the last undo removed' : 'Nothing undone to put back'}
              onClick={() => { if (!redoPid) return; suppressNextPickPop(); act('pick_made', { pid: redoPid }); }}>
              Redo Pick
            </button>
            {isCommish && (
              <button className="btn" data-testid="open-keepers" onClick={() => openPanel('keepers')}>
                Keepers{draft.keepers.length ? ` (${draft.keepers.length})` : ''}
              </button>
            )}
            {isCommish && (
              <button className="btn" data-testid="open-trades" onClick={() => openPanel('trades')}>
                Trades{draft.trades.length ? ` (${draft.trades.length})` : ''}
              </button>
            )}
            {done && !draft.completed && !mock && isCommish && (
              <button className="btn primary" data-testid="complete-draft" onClick={() => act('draft_completed')}>
                🏁 Complete draft
              </button>
            )}
          </div>
        </div>
      )}
      {isCommish && !mock && (
        <div className="card" id="export-card">
          <h3>Export Results</h3>
          <div className="util-row">
            <button className="btn" data-testid="xlsx-btn" id="xlsx-btn"
              disabled={!draft.picks.length}
              title={draft.picks.length ? 'Pick log, board grid, and rosters as a workbook' : 'No picks to export yet'}
              onClick={() => exportXlsx(config, draft, byPid, teamName, SEASON)}>
              Excel (.xlsx)
            </button>
            <button className="btn" data-testid="open-mfl" id="mfl-btn"
              disabled={!draft.picks.length}
              title={draft.picks.length ? 'Import the draft results into the MFL league' : 'No picks to send yet'}
              onClick={() => openPanel('mfl')}>
              Send to MFL
            </button>
          </div>
        </div>
      )}
      <div className="card" id="rec-card">
        <h3>Suggested Picks</h3>
        <div id="rec-list">
          {done ? (
            <div className="p-meta">Draft complete.</div>
          ) : !recs.length ? (
            <div className="p-meta">No draftable players left.</div>
          ) : (
            <>
              <div className="p-meta" style={{ marginBottom: 8 }}>
                {onClock ? <span style={{ color: 'var(--accent-text, #00ceb8)' }}>You're on the clock!</span> : `Your next pick: #${nextFor(config, draft, mySlot) ?? '—'}`}
              </div>
              <div className="top-sug" data-pid={top!.p.pid} onClick={() => onOpen?.(top!.p.pid)}>
                <div className="ts-label">★ TOP SUGGESTION</div>
                <div className="ts-hero">
                  <span className={`ts-ring ring-${top!.p.group}`}>
                    <img loading="lazy" src={headshot(top!.p.pid)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                  </span>
                  <div>
                    <div className="ts-name">{top!.p.name}</div>
                    <div className="ts-meta">{top!.p.pos} · {top!.p.team ?? 'FA'}{top!.p.tier ? ` · TIER ${top!.p.tier}` : ''}</div>
                    {top!.atRisk && <span className="ts-gone">GONE BY NEXT PICK</span>}
                  </div>
                </div>
                <div className="ts-stats">
                  <div className="ts-stat"><b>{top!.p.proj.toFixed(0)}</b><span>PROJ PTS</span></div>
                  <div className="ts-stat"><b>{(top!.p.vorp ?? 0) > 0 ? '+' : ''}{(top!.p.vorp ?? 0).toFixed(0)}</b><span>VS REPL</span></div>
                  <div className="ts-stat"><b>{top!.p.adp != null ? top!.p.adp.toFixed(0) : '—'}</b><span>ADP</span></div>
                </div>
                {/* on the clock a team drafts for itself now, so the spotlight
                    button is a real pick rather than a request */}
                {onClock && (isCommish || mock || !!onDraft) && (
                  <button className="ts-draft" onClick={(e) => {
                    e.stopPropagation();
                    if (onDraft) onDraft(top!.p.pid);
                    else act('pick_made', { pid: top!.p.pid });
                  }}>Draft now ⚡</button>
                )}
                {!onClock && !isCommish && !mock && (
                  <button className="ts-draft" onClick={(e) => { e.stopPropagation(); act('pick_requested', { pid: top!.p.pid, slot: session.slot }); }}>Ask for him ⚡</button>
                )}
              </div>
              <div className="ts-next-label">NEXT BEST</div>
              {recs.slice(1).map(({ p, atRisk }) => (
                <div key={p.pid} className="rec-item" data-pid={p.pid} onClick={() => onOpen?.(p.pid)}>
                  <span className={`pos-pill pos-${p.pos}`}>{p.pos}</span>
                  <div className="rec-main">
                    <div className="rec-name">{p.name}</div>
                    <div className="rec-why">
                      {p.proj.toFixed(0)} pts{p.tier ? ` · T${p.tier}` : ''} · {(p.vorp ?? 0) > 0 ? '+' : ''}{(p.vorp ?? 0).toFixed(0)} vs repl · ADP {p.adp != null ? p.adp.toFixed(0) : '—'}
                      {atRisk && <span className="rec-risk"> · GONE BY NEXT PICK</span>}
                    </div>
                  </div>
                  <span className="rec-pts">{p.proj.toFixed(0)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="card" id="safety-card">
        <h3>Draft Safety <span className="src">server-authoritative</span></h3>
        <div id="safety-body">
          <div className="p-meta">
            Every pick is an event in Postgres — <b>{events.length}</b> so far. No browser owns the
            board, so a lost laptop costs nothing.
          </div>
          <div className="util-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={downloadBackup}>Download backup</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

import { ownerOf as ownerOfFn } from '@fa/rules';
function nextFor(config: SeasonConfig, draft: DraftState, slot: number): number | null {
  const total = config.teams * config.rounds;
  for (let ov = draft.picks.length + 1; ov <= total; ov++) {
    if (ownerOfFn(config, draft, ov) === slot) return ov;
  }
  return null;
}
