// Draft Settings — v1's settings modal, over v2's stored season config.
//
// v1 kept this in localStorage, so it could be changed whenever. v2's config
// lives in Postgres and is FROZEN once the season has a draft log: every
// pick's coordinates were computed under the config in force when it landed,
// so re-shaping a board that already has picks would reinterpret history
// rather than record a change. The database enforces that (0003's trigger);
// this screen just refuses early and says why.

import { useState } from 'react';
import type { SeasonConfig } from '@fa/rules';
import { SEASON, transport, type Session } from '../api';
import { refreshConfig } from '../store';
import styles from './panel.module.css';

interface Props {
  config: SeasonConfig;
  locked: boolean; // the season has picks/keepers/trades bound to its shape
  mySlot: number;
  session: Session;
  onClose: () => void;
}

export function SettingsPanel({ config, locked, mySlot, session, onClose }: Props): React.JSX.Element {
  const [teams, setTeams] = useState(String(config.teams));
  const [rounds, setRounds] = useState(String(config.rounds));
  const [type, setType] = useState<'linear' | 'snake'>(config.type);
  const [order, setOrder] = useState<string[]>(config.order ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const n = Math.max(2, Math.min(16, Number(teams) || 0));
  // the order list follows the team count, keeping whatever names are already
  // typed rather than clearing the lot when the number changes
  const slots = Array.from({ length: n }, (_, i) => order[i] ?? '');

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await transport.setConfig(session, {
        teams: n,
        rounds: Math.max(1, Math.min(30, Number(rounds) || 0)),
        type,
        order: slots.map((s) => s.trim()),
      });
      await refreshConfig();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card} data-testid="settings-panel">
        <h2>Draft Settings</h2>
        {locked ? (
          <p className={styles.bad} data-testid="settings-locked">
            The {SEASON} board already has picks, keepers or trades on it, so its settings are
            frozen — each of those was recorded against this shape. Set a season up before
            anything lands on the board.
          </p>
        ) : (
          <p className={styles.hint}>
            The shape of the {SEASON} draft. Saved to the season itself, so every device gets it.
          </p>
        )}

        <div className="settings-grid">
          <label>Teams
            <input type="number" min={2} max={16} data-testid="set-teams"
              value={teams} disabled={locked} onChange={(e) => setTeams(e.target.value)} />
          </label>
          <label>Rounds
            <input type="number" min={1} max={30} data-testid="set-rounds"
              value={rounds} disabled={locked} onChange={(e) => setRounds(e.target.value)} />
          </label>
          <label>Type
            <select data-testid="set-type" value={type} disabled={locked}
              onChange={(e) => setType(e.target.value === 'snake' ? 'snake' : 'linear')}>
              <option value="linear">Straight (linear)</option>
              <option value="snake">Snake</option>
            </select>
          </label>
          <label>My slot
            <select data-testid="set-myslot" value={mySlot} disabled>
              <option value={mySlot}>{mySlot} — {slots[mySlot - 1] || `Team ${mySlot}`}</option>
            </select>
          </label>
        </div>

        <h3>Draft order</h3>
        <div id="set-order">
          {slots.map((name, i) => (
            <label key={i}>Slot {i + 1}
              <input data-testid={`set-slot-${i + 1}`} value={name} disabled={locked}
                onChange={(e) => {
                  const next = [...slots];
                  next[i] = e.target.value;
                  setOrder(next);
                }} />
            </label>
          ))}
        </div>

        {error && <p className={styles.bad} data-testid="settings-error">{error}</p>}

        <div className={styles.actions} style={{ gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" data-testid="settings-save"
            disabled={locked || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
