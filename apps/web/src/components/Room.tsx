// v1's shell, verbatim: topbar (brand / clock pill / mode switch / theme),
// the six main tabs, and each tab's v1 layout — over v2's event-sourced
// state. Mock mode is the one explicitly-pending piece.

import { useEffect, useMemo, useState } from 'react';
import { currentOverall, ownerOf, rosterBalance, roundOf } from '@fa/rules';
import { fetchPool, transport, type PoolDoc, type Session } from '../api';
import { useRoom } from '../store';
import { Analyzer } from './Analyzer';
import { Board } from './Board';
import { Drawer } from './Drawer';
import { KeepersPanel } from './KeepersPanel';
import { Pool } from './Pool';
import { SidePanel } from './SidePanel';
import { TeamsTab } from './TeamsTab';
import { TradesPanel } from './TradesPanel';
import { Values } from './Values';

type Tab = 'draft' | 'board' | 'teams' | 'analyzer' | 'values' | 'archive';
type Panel = 'keepers' | 'trades' | null;

const TAB_LABELS: [Tab, string][] = [
  ['draft', 'Draft Room'], ['board', 'Board'], ['teams', 'Teams'],
  ['analyzer', 'Analyzer'], ['values', 'Sleepers & Busts'], ['archive', 'Past Drafts'],
];

export function Room({ session, onLogout }: { session: Session; onLogout: () => void }): React.JSX.Element {
  const room = useRoom();
  const [pool, setPool] = useState<PoolDoc | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('draft');
  const [panel, setPanel] = useState<Panel>(null);
  const [drawerPid, setDrawerPid] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('fa-theme') ?? '');
  const players = pool?.players ?? [];

  useEffect(() => {
    void fetchPool().then(setPool);
  }, []);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const act = (type: string, payload: Record<string, unknown> = {}): void => {
    void transport.submit(session, type, payload).catch((e: Error) => {
      setToast(e.message);
      setTimeout(() => setToast(null), 5000);
    });
  };

  const byPid = useMemo(() => new Map(players.map((p) => [p.pid, p])), [players]);

  if (!room.ready || !room.config) {
    return (
      <div className="loading-screen"><div className="loading-card">
        <div className="spinner"></div><h2>Fantasy Architect</h2>
        <p>Connecting to the draft…</p>
      </div></div>
    );
  }

  const { config, draft } = room;
  const cur = currentOverall(draft);
  const total = config.teams * config.rounds;
  const boardFull = cur > total;
  const done = draft.completed || boardFull;
  const onClockSlot = done ? null : ownerOf(config, draft, cur);
  const teamName = (slot: number): string => config.order?.[slot - 1] ?? `Team ${slot}`;
  const isCommish = session.role === 'commish';
  const mySlot = session.slot ?? (config as { commish_slot?: number }).commish_slot ?? 11;
  const openRequest = draft.requests.find((r) => !r.resolved);
  const balance = rosterBalance(config, draft);
  const round = done ? config.rounds : roundOf(config, cur);
  const pickInRound = done ? config.teams : ((cur - 1) % config.teams) + 1;

  return (
    <div id="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">FA</span>
          <div className="brand-text">
            <span id="league-name">Fantasy Architect</span>
            <span className="brand-sub" id="league-sub">
              {config.teams} teams · {config.rounds} rounds · {config.type === 'linear' ? 'straight' : 'snake'} · you pick #{mySlot}
            </span>
          </div>
        </div>
        <div className="clock-banner" id="clock-banner" data-testid="onclock">
          {done ? (
            <span className="clock-pill">Draft complete — <span className="you">check the Analyzer</span></span>
          ) : !draft.started ? (
            <span className="clock-pill">
              Waiting for the draft to start
              {isCommish && (
                <button className="btn primary" data-testid="start-draft" style={{ marginLeft: 10 }} onClick={() => act('draft_started')}>
                  ▶ Start draft
                </button>
              )}
            </span>
          ) : (
            <span className="clock-pill">
              <span className="clock-dot"></span>
              On the clock:{' '}
              <span className={onClockSlot === session.slot ? 'you' : ''}>
                {teamName(onClockSlot!)}
                {onClockSlot === session.slot ? ' (You)' : ''}
              </span>
              <span className="pickno">
                Pick {round}.{String(pickInRound).padStart(2, '0')} · #{cur} overall · Round {round}/{config.rounds}
              </span>
            </span>
          )}
        </div>
        <nav className="mode-switch" id="mode-switch">
          <button className="active">Manual</button>
          <button disabled title="Mock drafts arrive with the next phase">Mock Draft</button>
        </nav>
        <span data-testid="conn" className="watch-status" style={{ color: room.connected ? 'var(--accent-text, #00ceb8)' : 'var(--warn, #f0b429)' }}>
          {room.connected ? '● live' : '○ reconnecting'}
        </span>
        <button className="icon-btn" id="theme-btn" title="Toggle light/dark theme"
          onClick={() => { const next = theme === 'light' ? '' : 'light'; setTheme(next); localStorage.setItem('fa-theme', next); }}>
          ☀
        </button>
        <button className="icon-btn" title={`${isCommish ? 'Commissioner' : `${teamName(mySlot)} (you)`} — sign out`} onClick={onLogout}>
          ⏻
        </button>
      </header>

      {toast && (
        <div data-testid="toast" className="watch-banner" role="alert" style={{ borderColor: 'var(--danger, #ff5c5c)' }}>
          ⚠ {toast}
        </div>
      )}
      {!balance.balanced && (
        <div data-testid="balance-chip" className="watch-banner" title="A trade is one-sided — every team must finish on exactly 20">
          ⚠ Uneven picks — {balance.offenders.map((o) => `${teamName(o.slot)} owns ${o.owns}`).join(', ')}. Fine mid-entry; the draft can't end like this.
        </div>
      )}
      {isCommish && openRequest && !done && (
        <div data-testid="req-banner" className="nom-request">
          <b>{teamName(openRequest.slot)}</b>&nbsp;asks for&nbsp;<b>{byPid.get(openRequest.pid)?.name ?? openRequest.pid}</b>
          <button
            className="btn primary"
            data-testid="req-accept"
            disabled={openRequest.slot !== onClockSlot}
            title={openRequest.slot !== onClockSlot ? 'That team is not on the clock yet' : undefined}
            onClick={() => act('pick_request_resolved', { request_seq: openRequest.seq, accepted: true })}
          >
            Take it
          </button>
          <button className="btn" data-testid="req-reject"
            onClick={() => act('pick_request_resolved', { request_seq: openRequest.seq, accepted: false })}>
            Reject
          </button>
        </div>
      )}

      <nav className="tabs" id="main-tabs">
        {TAB_LABELS.map(([t, label]) => (
          <button key={t} data-tab={t} data-testid={`tab-${t}`} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        <section className={`tab-panel ${tab === 'draft' ? 'active' : ''}`} id="tab-draft">
          <div className="draft-layout">
            <Pool
              players={players}
              draft={draft}
              config={config}
              teamName={teamName}
              mode={isCommish ? 'commish' : 'team'}
              mySlot={mySlot}
              disabled={!draft.started || done}
              onDraft={(pid) => act('pick_made', { pid })}
              onAsk={(pid) => act('pick_requested', { pid, slot: session.slot })}
              onOpen={setDrawerPid}
            />
            <SidePanel
              players={players}
              byPid={byPid}
              config={config}
              draft={draft}
              session={session}
              mySlot={mySlot}
              teamName={teamName}
              done={done}
              onClock={onClockSlot === mySlot}
              act={act}
              events={room.events}
              openPanel={setPanel}
              onOpen={setDrawerPid}
            />
          </div>
        </section>
        <section className={`tab-panel ${tab === 'board' ? 'active' : ''}`} id="tab-board">
          <Board config={config} draft={draft} byPid={byPid} teamName={teamName} cur={done ? null : cur} onOpen={setDrawerPid} />
        </section>
        <section className={`tab-panel ${tab === 'teams' ? 'active' : ''}`} id="tab-teams">
          <TeamsTab config={config} draft={draft} byPid={byPid} teamName={teamName} mySlot={session.slot} onOpen={setDrawerPid} />
        </section>
        <section className={`tab-panel ${tab === 'analyzer' ? 'active' : ''}`} id="tab-analyzer">
          <Analyzer config={config} draft={draft} byPid={byPid} teamName={teamName} />
        </section>
        <section className={`tab-panel ${tab === 'values' ? 'active' : ''}`} id="tab-values">
          <Values players={players} draft={draft} onOpen={setDrawerPid} />
        </section>
        <section className={`tab-panel ${tab === 'archive' ? 'active' : ''}`} id="tab-archive">
          <div className="card" style={{ maxWidth: 560 }}>
            <h3>Past Drafts</h3>
            <p className="p-meta">
              Nothing archived yet — the 2027 draft lands here when it's done. (The 2026 draft lives in
              the v1 app's archive.)
            </p>
          </div>
        </section>
      </main>

      {panel === 'keepers' && (
        <KeepersPanel config={config} draft={draft} byPid={byPid} players={players} teamName={teamName} act={act} onClose={() => setPanel(null)} />
      )}
      {panel === 'trades' && (
        <TradesPanel config={config} draft={draft} teamName={teamName} act={act} onClose={() => setPanel(null)} />
      )}
      {drawerPid && pool && (
        <Drawer
          pid={drawerPid}
          players={players}
          byPid={byPid}
          sosRanks={pool.sosRanks ?? {}}
          season={pool.season}
          prior={pool.prior ?? String(Number(pool.season) - 1)}
          config={config}
          draft={draft}
          teamName={teamName}
          mode={isCommish ? 'commish' : 'team'}
          mySlot={mySlot}
          done={done}
          disabled={!draft.started || done}
          onDraft={(pid) => act('pick_made', { pid })}
          onAsk={(pid) => act('pick_requested', { pid, slot: session.slot })}
          onOpen={setDrawerPid}
          onClose={() => setDrawerPid(null)}
        />
      )}
    </div>
  );
}
