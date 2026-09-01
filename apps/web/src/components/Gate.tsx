// The PIN screen — v1's gate page, ported. Same shape and copy: the FA mark,
// the uppercase italic wordmark, the subtitle, one wide letter-spaced PIN
// field, a fixed-height error line, and a full-width Unlock.
//
// v1 did this server-side in an edge function because the PIN was the whole
// security boundary. v2's PINs are checked by the auth-pin function against
// hashed rows, so the form can live in the app — but it is the first thing
// anyone sees, so it still looks like v1's.

import { useState } from 'react';
import { transport, type Session } from '../api';
import styles from './gate.module.css';

export function Gate({ onLogin }: { onLogin: (s: Session) => void }): React.JSX.Element {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (): Promise<void> => {
    if (!pin.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onLogin(await transport.login(pin));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false); // on success the Gate unmounts, so only reset on failure
    }
  };

  return (
    <div className={styles.wrap}>
      <form
        className={styles.card}
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <span className={styles.mark}>FA</span>
        <h1>Fantasy Architect</h1>
        <p>Enter your team PIN — or the league PIN for the full board.</p>
        <input
          data-testid="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          aria-label="League PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <div data-testid="gate-error" className={styles.error}>{error ?? ''}</div>
        <button data-testid="pin-submit" type="submit" disabled={busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
