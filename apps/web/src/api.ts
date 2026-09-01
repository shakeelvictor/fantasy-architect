// Transport layer. Locally this talks to tools/dev-api (the real migration
// in PGlite behind HTTP + SSE); against hosted Supabase the same four calls
// become PostgREST + Realtime through the same shapes. Nothing above this
// file knows which one it's on.

import type { DraftEvent, SeasonConfig } from '@fa/rules';

export const SEASON = 2027;
const API = '/api';

export interface Session {
  token: string;
  role: 'commish' | 'team';
  slot: number | null;
}

export interface PoolPlayer {
  pid: string;
  name: string;
  pos: string;
  group: string;
  team: string | null;
  proj: number;
  adp: number | null;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export async function login(pin: string): Promise<Session> {
  return jsonOrThrow(
    await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season: SEASON, pin }),
    }),
  );
}

export async function fetchBootstrap(): Promise<{ config: SeasonConfig; events: DraftEvent[] }> {
  return jsonOrThrow(await fetch(`${API}/bootstrap?season=${SEASON}`));
}

export async function fetchPlayers(): Promise<PoolPlayer[]> {
  const d = await jsonOrThrow<{ players: PoolPlayer[] }>(await fetch('/players.json'));
  return d.players;
}

export async function submit(
  session: Session,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<{ status: string; seq: number }> {
  return jsonOrThrow(
    await fetch(`${API}/rpc/submit_event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ season: SEASON, key: crypto.randomUUID(), type, payload }),
    }),
  );
}

/** SSE subscription with automatic reconnect + gap refill from `since`. */
export function streamEvents(
  since: () => number,
  onEvent: (e: DraftEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 500;

  const open = (): void => {
    if (closed) return;
    es = new EventSource(`${API}/stream?season=${SEASON}&since=${since()}`);
    es.onopen = () => {
      retry = 500;
      onStatus(true);
    };
    es.onmessage = (m) => onEvent(JSON.parse(m.data) as DraftEvent);
    es.onerror = () => {
      onStatus(false);
      es?.close();
      if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 5000)));
    };
  };
  open();
  return () => {
    closed = true;
    es?.close();
  };
}
