import { useEffect, useState } from 'react';
import type { Session } from './api';
import { Gate } from './components/Gate';
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

export function App(): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(savedSession);

  useEffect(() => {
    if (session) void connect();
  }, [session]);

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
