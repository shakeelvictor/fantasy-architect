// v1's shell, verbatim: topbar (brand / clock pill / mode switch / theme),
// the six main tabs, and each tab's v1 layout — over v2's event-sourced
// state. The mode switch flips between the real draft and the local mock.

import { useEffect, useMemo, useState } from 'react';
import { currentOverall, ownerOf, redoablePids, rosterBalance, roundOf } from '@fa/rules';
import { fetchPool, transport, type PoolDoc, type Session } from '../api';
import { useRoom } from '../store';
import { useTopbarFit } from '../topbar';
import { suppressNextPickPop, useCelebrations } from '../celebrate';
import { mockEvents, mockState, mockSubmit, stopBots, useMock } from '../mock';
import { Analyzer } from './Analyzer';
import { ArchiveTab } from './ArchiveTab';
import { Board } from './Board';
import { DraftConfirm } from './DraftConfirm';
import { Drawer } from './Drawer';
import { KeepersPanel } from './KeepersPanel';
import { MflPanel } from './MflPanel';
import { MockControls } from './MockControls';
import { Pool } from './Pool';
import { SettingsPanel } from './SettingsPanel';
import { SidePanel } from './SidePanel';
import { TeamsTab } from './TeamsTab';
import { Ticker } from './Ticker';
import { TradesPanel } from './TradesPanel';
import { Values } from './Values';

type Tab = 'draft' | 'board' | 'teams' | 'analyzer' | 'values' | 'archive';
type Panel = 'keepers' | 'trades' | 'mfl' | 'settings' | null;

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
  const [confirmPid, setConfirmPid] = useState<string | null>(null);
  const [modeSel, setModeSel] = useState<'manual' | 'mock'>('manual');
  const mock = useMock();
  const [theme, setTheme] = useState(() => localStorage.getItem('fa-theme') ?? '');
  const players = pool?.players ?? [];

  useTopbarFit(room.ready && !!room.config);

  useEffect(() => {
    void fetchPool().then(setPool);
  }, []);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const isMock = modeSel === 'mock';
  const mySlotSafe = session.slot ?? (room.config as { commish_slot?: number } | null)?.commish_slot ?? 11;

  // mock mode is body-wide (v1's is-mock topbar stripe), and entering it
  // starts the local draft so picking works with the bots paused
  useEffect(() => {
    document.body.classList.toggle('is-mock', isMock);
    if (isMock && room.config) mockSubmit(room.config, room.events, mySlotSafe, 'draft_started');
    if (!isMock) stopBots();
    return () => document.body.classList.remove('is-mock');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMock, room.config]);

  // In mock mode every draft mutation goes to the LOCAL log through the same
  // reducer — the server never hears about it. Everything else (keepers,
  // trades) stays real, exactly like v1's shared keeper list.
  const act = (type: string, payload: Record<string, unknown> = {}): void => {
    if (isMock) {
      if (type === 'pick_made' || type === 'pick_requested') {
        mockSubmit(room.config!, room.events, mySlotSafe, 'pick_made', payload);
        return;
      }
      if (type === 'pick_undone' || type === 'draft_started') {
        mockSubmit(room.config!, room.events, mySlotSafe, type);
        return;
      }
      if (type === 'draft_completed' || type === 'pick_request_resolved') return; // meaningless in a mock
      // keepers and trades stay REAL even while mocking (v1's shared list) —
      // they fall through to the server and flow back into the mock's seed
    }
    void transport.submit(session, type, payload).catch((e: Error) => {
      setToast(e.message);
      setTimeout(() => setToast(null), 5000);
    });
  };

  const byPid = useMemo(() => new Map(players.map((p) => [p.pid, p])), [players]);

  // Derived above the loading-screen early return, because useCelebrations
  // below is a hook and must run on every render — including the ones where
  // the room is still connecting. It no-ops on a null config.
  const cfg = room.config;
  const draft = isMock && cfg ? mockState(room.events) : room.draft;
  const cur = currentOverall(draft);
  const total = cfg ? cfg.teams * cfg.rounds : 0;
  const done = !!cfg && (draft.completed || cur > total);
  const teamName = (slot: number): string => cfg?.order?.[slot - 1] ?? `Team ${slot}`;
  const mySlot = session.slot ?? (cfg as { commish_slot?: number } | null)?.commish_slot ?? 11;

  useCelebrations({ config: cfg, draft, byPid, teamName, mySlot, done, isMock, botsRunning: mock.running });

  if (!room.ready || !cfg) {
    return (
      <div className="loading-screen"><div className="loading-card">
        <div className="spinner"></div><h2>Fantasy Architect</h2>
        {/* v1 said "pulling from Sleeper… up to a minute" here, which was true
            of v1 and is not of v2 — the pool is baked and the log is a few
            rows. Same card, honest words. */}
        <p>Loading the player pool and replaying the draft log — every device
          rebuilds the same board from the same events.</p>
      </div></div>
    );
  }

  const config = cfg;
  const onClockSlot = done ? null : ownerOf(config, draft, cur);
  const isCommish = session.role === 'commish';
  const openRequest = draft.requests.find((r) => !r.resolved);
  const redoPid = redoablePids(isMock ? mockEvents(room.events) : room.events).at(-1) ?? null;
  // v1's rule: the confirm guard sits on the three HUMAN buttons only —
  // Ask/Take-it are their own confirmation, bots and redo never see it
  const requestDraft = (pid: string): void => setConfirmPid(pid);
  // mirrors 0005's trigger: only events that NAME a slot or round bind the
  // board's shape, so a season that has merely been started can still be set up
  const configFrozen = room.events.some(
    (e) => e.type !== 'draft_started' && e.type !== 'draft_completed',
  );
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
          <button className={!isMock ? 'active' : ''} data-testid="mode-manual" onClick={() => setModeSel('manual')}>Manual</button>
          <button className={isMock ? 'active' : ''} data-testid="mode-mock"
            title="Practice run — bots pick for the other teams; the real draft is untouched"
            onClick={() => setModeSel('mock')}>Mock Draft</button>
        </nav>
        <span data-testid="conn" className="watch-status" style={{ color: room.connected ? 'var(--accent-text, #00ceb8)' : 'var(--warn, #f0b429)' }}>
          {room.connected ? '● live' : '○ reconnecting'}
        </span>
        <button className="icon-btn" id="theme-btn" title="Toggle light/dark theme"
          onClick={() => { const next = theme === 'light' ? '' : 'light'; setTheme(next); localStorage.setItem('fa-theme', next); }}>
          ☀
        </button>
        {isCommish && (
          <button className="icon-btn" id="settings-btn" data-testid="open-settings" title="Draft settings"
            onClick={() => setPanel('settings')}>
            ⚙
          </button>
        )}
        <button className="icon-btn" title={`${isCommish ? 'Commissioner' : `${teamName(mySlot)} (you)`} — sign out`} onClick={onLogout}>
          ⏻
        </button>
      </header>

      <Ticker config={config} draft={draft} byPid={byPid} teamName={teamName} mySlot={mySlot} done={done} />

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
              mode={isCommish || isMock ? 'commish' : 'team'}
              mySlot={mySlot}
              disabled={!draft.started || done || (isMock && mock.running && onClockSlot !== mySlot)}
              onDraft={requestDraft}
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
              mock={isMock}
              redoPid={redoPid}
              onDraft={requestDraft}
              mockPanel={isMock
                ? <MockControls players={players} byPid={byPid} config={config} events={room.events} mySlot={mySlot} />
                : null}
            />
          </div>
        </section>
        <section className={`tab-panel ${tab === 'board' ? 'active' : ''}`} id="tab-board">
          <Board config={config} draft={draft} byPid={byPid} teamName={teamName} cur={done ? null : cur} mySlot={mySlot} onOpen={setDrawerPid} />
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
          <ArchiveTab config={config} draft={room.draft} byPid={byPid} teamName={teamName} />
        </section>
      </main>

      {panel === 'keepers' && (
        <KeepersPanel config={config} draft={room.draft} byPid={byPid} players={players} teamName={teamName} act={act} onClose={() => setPanel(null)} />
      )}
      {panel === 'trades' && (
        <TradesPanel config={config} draft={room.draft} teamName={teamName} act={act} onClose={() => setPanel(null)} />
      )}
      {panel === 'settings' && (
        <SettingsPanel config={config} locked={configFrozen} mySlot={mySlot}
          session={session} onClose={() => setPanel(null)} />
      )}
      {panel === 'mfl' && (
        <MflPanel config={config} draft={room.draft} byPid={byPid} teamName={teamName} session={session} onClose={() => setPanel(null)} />
      )}
      {/* celebration overlays — never take pointer events, remove themselves */}
      <div id="pick-pop" className="pick-pop" aria-live="polite"></div>
      <div id="draft-finale" className="finale hidden" aria-hidden="true"></div>

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
          mode={isCommish || isMock ? 'commish' : 'team'}
          mySlot={mySlot}
          done={done}
          disabled={!draft.started || done || (isMock && mock.running && onClockSlot !== mySlot)}
          onDraft={requestDraft}
          onAsk={(pid) => act('pick_requested', { pid, slot: session.slot })}
          onOpen={setDrawerPid}
          onClose={() => setDrawerPid(null)}
        />
      )}
      {confirmPid && byPid.has(confirmPid) && (
        <DraftConfirm
          p={byPid.get(confirmPid)!}
          config={config}
          draft={draft}
          teamName={teamName}
          mySlot={mySlot}
          isMock={isMock}
          onAnswer={(ok) => {
            setConfirmPid(null);
            if (ok) {
              act('pick_made', { pid: confirmPid });
              setDrawerPid(null); // a drawer-initiated draft closes the card too (v1)
            }
          }}
        />
      )}
    </div>
  );
}
