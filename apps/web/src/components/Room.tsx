import { useEffect, useState } from 'react';
import { currentOverall, ownerOf, roundOf } from '@fa/rules';
import { fetchPlayers, submit, type PoolPlayer, type Session } from '../api';
import { useRoom } from '../store';
import { Board } from './Board';
import { Pool } from './Pool';
import styles from './room.module.css';

export function Room({ session, onLogout }: { session: Session; onLogout: () => void }): React.JSX.Element {
  const room = useRoom();
  const [players, setPlayers] = useState<PoolPlayer[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void fetchPlayers().then(setPlayers);
  }, []);

  const act = async (type: string, payload: Record<string, unknown> = {}): Promise<void> => {
    try {
      await submit(session, type, payload);
    } catch (e) {
      setToast((e as Error).message);
      setTimeout(() => setToast(null), 5000);
    }
  };

  if (!room.ready || !room.config) return <div className={styles.loading}>Connecting…</div>;

  const { config, draft } = room;
  const cur = currentOverall(draft);
  const total = config.teams * config.rounds;
  const done = draft.completed || cur > total;
  const onClockSlot = done ? null : ownerOf(config, draft, cur);
  const teamName = (slot: number): string => config.order?.[slot - 1] ?? `Team ${slot}`;
  const isCommish = session.role === 'commish';
  const openRequest = draft.requests.find((r) => !r.resolved);
  const byPid = new Map(players.map((p) => [p.pid, p]));

  return (
    <div className={styles.app}>
      <header className={styles.bar}>
        <span className={styles.brand}>FA</span>
        <span data-testid="onclock" className={styles.clock}>
          {done ? (
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
          <button data-testid="start-draft" onClick={() => void act('draft_started')}>
            ▶ Start draft
          </button>
        )}
        {isCommish && draft.started && draft.picks.length > 0 && !done && (
          <button data-testid="undo" onClick={() => void act('pick_undone')}>
            Undo pick
          </button>
        )}
        <span className={styles.spacer} />
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

      {isCommish && openRequest && !done && (
        <div data-testid="req-banner" className={styles.request}>
          <b>{teamName(openRequest.slot)}</b> asks for <b>{byPid.get(openRequest.pid)?.name ?? openRequest.pid}</b>
          <button
            data-testid="req-accept"
            disabled={openRequest.slot !== onClockSlot}
            title={openRequest.slot !== onClockSlot ? 'That team is not on the clock yet' : undefined}
            onClick={() => void act('pick_request_resolved', { request_seq: openRequest.seq, accepted: true })}
          >
            Take it
          </button>
          <button
            data-testid="req-reject"
            onClick={() => void act('pick_request_resolved', { request_seq: openRequest.seq, accepted: false })}
          >
            Reject
          </button>
        </div>
      )}

      <main className={styles.main}>
        <Pool
          players={players}
          draft={draft}
          teamName={teamName}
          mode={isCommish ? 'commish' : 'team'}
          disabled={!draft.started || done}
          onDraft={(pid) => void act('pick_made', { pid })}
          onAsk={(pid) => void act('pick_requested', { pid, slot: session.slot })}
        />
        <Board config={config} draft={draft} byPid={byPid} teamName={teamName} cur={done ? null : cur} />
      </main>
    </div>
  );
}
