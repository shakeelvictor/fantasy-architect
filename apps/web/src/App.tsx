import { useEffect, useState } from 'react';
import type { Session } from './api';
import { Gate } from './components/Gate';
import { PublicSeason } from './components/PublicSeason';
import { Room } from './components/Room';
import { connect } from './store';

const KEY = 'fa2-session';

function savedSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

/** `/2026` — the public record of one past draft. Read before any session
 *  check, so it is never gated: the archive it reads is a world-readable
 *  static file either way, and the PIN exists to gate writes. */
function publicYear(): number | null {
  const m = window.location.pathname.match(/^\/(\d{4})\/?$/);
  return m ? Number(m[1]) : null;
}

export function App(): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(savedSession);
  const year = publicYear();

  useEffect(() => {
    if (session && year == null) void connect();
  }, [session, year]);

  if (year != null) return <PublicSeason year={year} />;

  if (!session) {
    return (
      <Gate
        onLogin={(s) => {
          localStorage.setItem(KEY, JSON.stringify(s));
          setSession(s);
        }}
      />
    );
  }
  return (
    <Room
      session={session}
      onLogout={() => {
        localStorage.removeItem(KEY);
        setSession(null);
      }}
    />
  );
}
