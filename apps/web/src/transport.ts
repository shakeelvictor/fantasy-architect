// One interface, two transports. `local` talks to tools/dev-api (the real
// migration in PGlite behind HTTP + SSE); `supabase` talks to the hosted
// platform — auth-pin edge function, PostgREST RPC, and Realtime
// postgres_changes. Selection is by env: set VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY (plus VITE_SEASON) and the app runs hosted;
// leave them unset and dev/e2e keep the local server. Nothing above this
// file knows which one it is on.

import { createClient } from '@supabase/supabase-js';
import type { DraftEvent, SeasonConfig } from '@fa/rules';

export const SEASON = Number(import.meta.env.VITE_SEASON ?? 2027);

export interface Session {
  token: string;
  role: 'commish' | 'team';
  slot: number | null;
}

export interface SubmitResult {
  status: string;
  seq: number;
}

export interface MflSetup {
  leagueName: string;
  franchises: { id: string; name: string }[];
  map: Record<string, string>;
  unmatched: { id: string; name: string; pos: string; team: string | null }[];
}

export interface Transport {
  kind: 'local' | 'supabase';
  login(pin: string): Promise<Session>;
  /** MFL proxy (no CORS on MFL, so calls go through our server side). */
  mfl(session: Session, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Re-shape a season. Commissioner only, and refused once it has a log. */
  setConfig(session: Session, config: SeasonConfig): Promise<unknown>;
  bootstrap(): Promise<{ config: SeasonConfig; events: DraftEvent[] }>;
  submit(session: Session, type: string, payload?: Record<string, unknown>): Promise<SubmitResult>;
  /** Live events with reconnect; implementations must refill gaps from since(). */
  stream(
    since: () => number,
    onEvent: (e: DraftEvent) => void,
    onStatus: (connected: boolean) => void,
  ): () => void;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  return body;
}

// ------------------------------------------------------------------ local

function localTransport(): Transport {
  const API = '/api';
  return {
    kind: 'local',
    async setConfig(session, config) {
      return jsonOrThrow(
        await fetch(`${API}/rpc/set_season_config`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ season: SEASON, config }),
        }),
      );
    },
    async mfl(session, body) {
      return jsonOrThrow(
        await fetch(`${API}/mfl`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
          body: JSON.stringify(body),
        }),
      );
    },
    async login(pin) {
      return jsonOrThrow(
        await fetch(`${API}/auth`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ season: SEASON, pin }),
        }),
      );
    },
    async bootstrap() {
      return jsonOrThrow(await fetch(`${API}/bootstrap?season=${SEASON}`));
    },
    async submit(session, type, payload = {}) {
      return jsonOrThrow(
        await fetch(`${API}/rpc/submit_event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ season: SEASON, key: crypto.randomUUID(), type, payload }),
        }),
      );
    },
    stream(since, onEvent, onStatus) {
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
    },
  };
}

// --------------------------------------------------------------- supabase

function supabaseTransport(url: string, anonKey: string): Transport {
  const client = createClient(url, anonKey);
  return {
    kind: 'supabase',
    async setConfig(session, config) {
      const res = await fetch(`${url}/rest/v1/rpc/set_season_config`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: anonKey,
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ p_season: SEASON, p_config: config }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      return body;
    },
    async mfl(session, body) {
      return jsonOrThrow(
        await fetch(`${url}/functions/v1/mfl`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            apikey: anonKey,
            authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify(body),
        }),
      );
    },
    async login(pin) {
      return jsonOrThrow(
        await fetch(`${url}/functions/v1/auth-pin`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({ season: SEASON, pin }),
        }),
      );
    },
    async bootstrap() {
      const headers = { apikey: anonKey, authorization: `Bearer ${anonKey}` };
      const [cfg, events] = await Promise.all([
        jsonOrThrow<{ config: SeasonConfig }[]>(
          await fetch(`${url}/rest/v1/seasons?year=eq.${SEASON}&select=config`, { headers }),
        ),
        jsonOrThrow<DraftEvent[]>(
          await fetch(`${url}/rest/v1/draft_events?season=eq.${SEASON}&select=seq,type,payload&order=seq`, { headers }),
        ),
      ]);
      if (!cfg[0]) throw new Error(`season ${SEASON} is not seeded`);
      return { config: cfg[0].config, events };
    },
    async submit(session, type, payload = {}) {
      const res = await fetch(`${url}/rest/v1/rpc/submit_event`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: anonKey,
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ p_season: SEASON, p_key: crypto.randomUUID(), p_type: type, p_payload: payload }),
      });
      const body = (await res.json()) as SubmitResult & { message?: string; code?: string };
      if (!res.ok) {
        if (body.code === 'PGRST301') throw new Error('PIN session expired — sign out and unlock again');
        // PostgREST wraps our trigger exceptions; the raise message is what matters
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      return body;
    },
    stream(since, onEvent, onStatus) {
      // Realtime does not replay: refill anything missed since `since()` on
      // every (re)subscribe, then ride live INSERTs.
      const refill = async (): Promise<void> => {
        const events = await jsonOrThrow<DraftEvent[]>(
          await fetch(
            `${url}/rest/v1/draft_events?season=eq.${SEASON}&seq=gt.${since()}&select=seq,type,payload&order=seq`,
            { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } },
          ),
        );
        for (const e of events) onEvent(e);
      };
      const channel = client
        .channel(`draft-${SEASON}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'draft_events', filter: `season=eq.${SEASON}` },
          (msg) => onEvent(msg.new as DraftEvent),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void refill().then(() => onStatus(true));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            onStatus(false);
          }
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}

const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const transport: Transport =
  supaUrl && supaKey ? supabaseTransport(supaUrl, supaKey) : localTransport();
