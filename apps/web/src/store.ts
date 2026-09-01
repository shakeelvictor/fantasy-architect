// The client's whole state model: an ordered event log folded through
// @fa/rules — the same reducer the server's SQL fold mirrors. Every browser
// folds the same log, so every browser renders the same draft. No client
// ever "owns" the board.

import { useSyncExternalStore } from 'react';
import { foldEvents, initialState, type DraftEvent, type DraftState, type SeasonConfig } from '@fa/rules';
import { transport } from './transport';

export interface RoomState {
  ready: boolean;
  connected: boolean;
  config: SeasonConfig | null;
  events: DraftEvent[];
  draft: DraftState;
}

let state: RoomState = { ready: false, connected: false, config: null, events: [], draft: initialState() };
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function emit(next: Partial<RoomState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function ingest(incoming: DraftEvent[]): void {
  const known = new Set(state.events.map((e) => e.seq));
  const fresh = incoming.filter((e) => !known.has(e.seq));
  if (!fresh.length) return;
  const events = [...state.events, ...fresh].sort((a, b) => a.seq - b.seq);
  emit({ events, draft: foldEvents(events) });
}

export async function connect(): Promise<void> {
  if (stop) return;
  const boot = await transport.bootstrap();
  emit({ ready: true, config: boot.config });
  ingest(boot.events);
  stop = transport.stream(
    () => state.events.at(-1)?.seq ?? 0,
    (e) => ingest([e]),
    (connected) => emit({ connected }),
  );
}

export function disconnect(): void {
  stop?.();
  stop = null;
}

export function useRoom(): RoomState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}
