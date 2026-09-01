import { useState } from 'react';
import { overallFor, rosterBalance, type DraftState, type SeasonConfig } from '@fa/rules';
import styles from './panel.module.css';

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  teamName: (slot: number) => string;
  act: (type: string, payload: Record<string, unknown>) => void;
  onClose: () => void;
}

export function TradesPanel({ config, draft, teamName, act, onClose }: Props): React.JSX.Element {
  const [a, setA] = useState(1);
  const [ra, setRa] = useState('');
  const [b, setB] = useState(2);
  const [rb, setRb] = useState('');
  const balance = rosterBalance(config, draft);

  const teamOptions = Array.from({ length: config.teams }, (_, i) => (
    <option key={i + 1} value={i + 1}>
      {teamName(i + 1)}
    </option>
  ));

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card} data-testid="trades-panel">
        <h2>Trades</h2>
        {balance.balanced ? (
          <p className={styles.ok} data-testid="balance-ok">
            ✓ Every team finishes on {balance.target} players.
          </p>
        ) : (
          <p className={styles.bad} data-testid="balance-bad">
            ⚠ Uneven —{' '}
            {balance.offenders.map((o) => `${teamName(o.slot)} owns ${o.owns}`).join(', ')}. Fine
            mid-entry; the draft can't END like this.
          </p>
        )}
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (ra) act('pick_traded', { round: Number(ra), from_slot: a, to_slot: b });
            if (rb) act('pick_traded', { round: Number(rb), from_slot: b, to_slot: a });
            setRa('');
            setRb('');
          }}
        >
          <h3>Pick swap — both sides</h3>
          <div className={styles.inline}>
            <select data-testid="trade-a" value={a} onChange={(e) => setA(Number(e.target.value))}>{teamOptions}</select>
            <span>gives R</span>
            <input data-testid="trade-a-round" type="number" min={1} max={config.rounds} value={ra} onChange={(e) => setRa(e.target.value)} />
            <span>⇄</span>
            <select data-testid="trade-b" value={b} onChange={(e) => setB(Number(e.target.value))}>{teamOptions}</select>
            <span>gives R</span>
            <input data-testid="trade-b-round" type="number" min={1} max={config.rounds} value={rb} onChange={(e) => setRb(e.target.value)} />
            <button data-testid="trade-submit" type="submit" disabled={a === b || (!ra && !rb)}>
              Record
            </button>
          </div>
        </form>
        <div className={styles.list}>
          <h3>In force</h3>
          {draft.trades.length === 0 && <p className={styles.hint}>No trades yet.</p>}
          {draft.trades.map((t) => {
            const ov = overallFor(config, t.from_slot, t.round);
            const used = draft.picks.some((p) => p.overall === ov);
            return (
              <div key={`${t.round}:${t.from_slot}`} className={styles.row} data-testid={`trade-${t.round}-${t.from_slot}`}>
                <span>
                  R{t.round} pick of <b>{teamName(t.from_slot)}</b> → <b>{teamName(t.to_slot)}</b>
                  <small> #{ov}{used ? ' · already used' : ''}</small>
                </span>
                <button
                  data-testid={`untrade-${t.round}-${t.from_slot}`}
                  disabled={used}
                  title={used ? 'Pick already used' : `Return this pick to ${teamName(t.from_slot)}`}
                  onClick={() => act('trade_reverted', { round: t.round, from_slot: t.from_slot })}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div className={styles.actions}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
