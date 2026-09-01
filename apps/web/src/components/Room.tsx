import { useEffect, useState } from 'react';
import { currentOverall, ownerOf, rosterBalance, roundOf } from '@fa/rules';
import { fetchPlayers, transport, type PoolPlayer, type Session } from '../api';
import { useRoom } from '../store';
import { Board } from './Board';
import { KeepersPanel } from './KeepersPanel';
import { Pool } from './Pool';
import { TeamsTab } from './TeamsTab';
import { TradesPanel } from './TradesPanel';
import styles from './room.module.css';

type Tab = 'draft' | 'teams';
type Panel = 'keepers' | 'trades' | null;

export function Room({ session, onLogout }: { session: Session; onLogout: () => void }): React.JSX.Element {
  const room = useRoom();
  const [players, setPlayers] = useState<PoolPlayer[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('draft');
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    void fetchPlayers().then(setPlayers);
  }, []);

  const act = (type: string, payload: Record<string, unknown> = {}): void => {
    void transport.submit(session, type, payload).catch((e: Error) => {
      setToast(e.message);
      setTimeout(() => setToast(null), 5000);
    });
  };

  if (!room.ready || !room.config) return <div className={styles.loading}>Connecting…</div>;

  const { config, draft } = room;
  const cur = currentOverall(draft);
  const total = config.teams * config.rounds;
  const boardFull = cur > total;
  const done = draft.completed;
  const onClockSlot = boardFull || done ? null : ownerOf(config, draft, cur);
  const teamName = (slot: number): string => config.order?.[slot - 1] ?? `Team ${slot}`;
  const isCommish = session.role === 'commish';
  const openRequest = draft.requests.find((r) => !r.resolved);
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const balance = rosterBalance(config, draft);

  return (
    <div className={styles.app}>
      <header className={styles.bar}>
        <span className={styles.brand}>FA</span>
        <nav className={styles.tabs}>
          <button data-testid="tab-draft" className={tab === 'draft' ? styles.tabActive : ''} onClick={() => setTab('draft')}>
            Draft Room
          </button>
          <button data-testid="tab-teams" className={tab === 'teams' ? styles.tabActive : ''} onClick={() => setTab('teams')}>
            Teams
          </button>
        </nav>
        <span data-testid="onclock" className={styles.clock}>
          {done || boardFull ? (
            'Draft complete'
          ) : draft.started ? (
            <>
              On the clock: <b>{teamName(onClockSlot!)}</b>
              <span className={`${styles.pickno} num`}>
                {' '}
                · pick {roundOf(config, cur)}.{String(((cur - 1) % config.teams) + 1).padStart(2, '0')} · #{cur}
              </span>
            </>
          ) : (
            'Waiting for the draft to start'
          )}
        </span>
        {isCommish && !draft.started && (
          <button data-testid="start-draft" onClick={() => act('draft_started')}>
            ▶ Start draft
          </button>
        )}
        {isCommish && draft.started && draft.picks.length > 0 && !done && (
          <button data-testid="undo" onClick={() => act('pick_undone')}>
            Undo pick
          </button>
        )}
        {isCommish && boardFull && !done && (
          <button data-testid="complete-draft" onClick={() => act('draft_completed')}>
            🏁 Complete draft
          </button>
        )}
        {isCommish && (
          <>
            <button data-testid="open-keepers" onClick={() => setPanel('keepers')}>
              Keepers{draft.keepers.length ? ` (${draft.keepers.length})` : ''}
            </button>
            <button data-testid="open-trades" onClick={() => setPanel('trades')}>
              Trades{draft.trades.length ? ` (${draft.trades.length})` : ''}
            </button>
          </>
        )}
        <span className={styles.spacer} />
        {!balance.balanced && (
          <span data-testid="balance-chip" className={styles.balanceChip} title="A trade is one-sided — every team must finish on exactly 20">
            ⚠ uneven picks
          </span>
        )}
        <span data-testid="conn" className={room.connected ? styles.connOn : styles.connOff}>
          {room.connected ? '● live' : '○ reconnecting'}
        </span>
        <span className={styles.who}>
          {isCommish ? 'Commissioner' : `${teamName(session.slot!)} (you)`}
        </span>
        <button onClick={onLogout}>Sign out</button>
      </header>

      {toast && (
        <div data-testid="toast" className={styles.toast} role="alert">
          ⚠ {toast}
        </div>
      )}

      {isCommish && openRequest && !done && !boardFull && (
        <div data-testid="req-banner" className={styles.request}>
          <b>{teamName(openRequest.slot)}</b> asks for <b>{byPid.get(openRequest.pid)?.name ?? openRequest.pid}</b>
          <button
            data-testid="req-accept"
            disabled={openRequest.slot !== onClockSlot}
            title={openRequest.slot !== onClockSlot ? 'That team is not on the clock yet' : undefined}
            onClick={() => act('pick_request_resolved', { request_seq: openRequest.seq, accepted: true })}
          >
            Take it
          </button>
          <button
            data-testid="req-reject"
            onClick={() => act('pick_request_resolved', { request_seq: openRequest.seq, accepted: false })}
          >
            Reject
          </button>
        </div>
      )}

      {tab === 'draft' ? (
        <main className={styles.main}>
          <Pool
            players={players}
            draft={draft}
            teamName={teamName}
            mode={isCommish ? 'commish' : 'team'}
            disabled={!draft.started || done || boardFull}
            onDraft={(pid) => act('pick_made', { pid })}
            onAsk={(pid) => act('pick_requested', { pid, slot: session.slot })}
          />
          <Board config={config} draft={draft} byPid={byPid} teamName={teamName} cur={done || boardFull ? null : cur} />
        </main>
      ) : (
        <main className={styles.mainSingle}>
          <TeamsTab config={config} draft={draft} byPid={byPid} teamName={teamName} mySlot={session.slot} />
        </main>
      )}

      {panel === 'keepers' && (
        <KeepersPanel
          config={config}
          draft={draft}
          byPid={byPid}
          players={players}
          teamName={teamName}
          act={act}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'trades' && (
        <TradesPanel config={config} draft={draft} teamName={teamName} act={act} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}
