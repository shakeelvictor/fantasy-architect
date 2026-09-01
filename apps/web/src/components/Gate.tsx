import { useState } from 'react';
import { transport, type Session } from '../api';
import styles from './gate.module.css';

export function Gate({ onLogin }: { onLogin: (s: Session) => void }): React.JSX.Element {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onLogin(await transport.login(pin));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form
        className={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <div className={styles.mark}>FA</div>
        <h1>Fantasy Architect</h1>
        <p>Enter your team PIN — or the league PIN for the commissioner board.</p>
        <div className={styles.row}>
          <input
            data-testid="pin-input"
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button data-testid="pin-submit" type="submit" disabled={busy || !pin}>
            Unlock
          </button>
        </div>
        {error && (
          <p data-testid="gate-error" className={styles.error}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
