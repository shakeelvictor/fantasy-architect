// Mock drafts — client-side only, and through the SHARED reducer: the mock
// board is foldEvents over [the real log's keeper/trade events] + a LOCAL
// event list that mirrors what submit_event would have written (server-side
// pick coordinates, keeper auto-fill chaining, the undo cascade). Nothing
// here ever touches the server; the real draft and the mock can't cross.

import { useSyncExternalStore } from 'react';
import {
  foldEvents, overallFor, ownerOf, roundOf,
  type DraftEvent, type DraftState, type SeasonConfig,
} from '@fa/rules';
import type { PoolPlayer } from './api';
import { SEASON } from './transport';
import { botPick } from './v1logic';

const KEY = `fa-mock-${SEASON}`;
const LOCAL_SEQ_BASE = 1_000_000_000; // above any real seq, below nothing local

// keeper/trade shape flows into the mock from the REAL log — a keeper
// declared for the real draft appears in the mock too, exactly like v1's
// shared keeper list. Picks and requests never cross over.
const SEED_TYPES = new Set(['keeper_declared', 'keeper_removed', 'pick_traded', 'trade_reverted']);

function readLocal(): DraftEvent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as DraftEvent[]) : [];
  } catch {
    return [];
  }
}

interface MockStore {
  local: DraftEvent[];
  running: boolean;
  speed: number; // ms between bot picks (v1's 3200 - slider)
}

let store: MockStore = { local: readLocal(), running: false, speed: 2300 };
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<MockStore>): void {
  store = { ...store, ...next };
  if (next.local) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next.local));
    } catch { /* storage full — the mock is disposable */ }
  }
  for (const l of listeners) l();
}

export function useMock(): MockStore {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => store,
  );
}

export function mockEvents(realEvents: DraftEvent[]): DraftEvent[] {
  return [...realEvents.filter((e) => SEED_TYPES.has(e.type)), ...store.local];
}

export function mockState(realEvents: DraftEvent[]): DraftState {
  return foldEvents(mockEvents(realEvents));
}

function nextSeq(): number {
  return LOCAL_SEQ_BASE + store.local.length;
}

// fa_apply_due_keepers, locally: when the mock reaches a pick a registered
// keeper is owed at, it's consumed automatically — consecutive keepers chain.
function applyDueKeepers(config: SeasonConfig, realEvents: DraftEvent[], out: DraftEvent[]): void {
  const total = config.teams * config.rounds;
  for (;;) {
    const st = foldEvents([...mockEvents(realEvents), ...out]);
    const cur = st.picks.length + 1;
    if (cur > total) return;
    const k = st.keepers.find((x) => overallFor(config, x.slot, x.round) === cur);
    if (!k) return;
    out.push({
      seq: nextSeq() + out.length,
      type: 'pick_made',
      payload: { pid: k.pid, overall: cur, round: k.round, slot: k.slot, is_keeper: true },
    });
  }
}

// The local mirror of submit_event: the client names a player, this decides
// where the pick lands, and keepers chain in after — same rules, no server.
export function mockSubmit(
  config: SeasonConfig, realEvents: DraftEvent[], mySlot: number,
  type: 'draft_started' | 'pick_made' | 'pick_undone', payload: Record<string, unknown> = {},
): void {
  const st = mockState(realEvents);
  const out: DraftEvent[] = [];

  if (type === 'draft_started') {
    if (st.started) return;
    out.push({ seq: nextSeq(), type, payload: {} });
    applyDueKeepers(config, realEvents, out);
  } else if (type === 'pick_made') {
    const cur = st.picks.length + 1;
    if (cur > config.teams * config.rounds) return;
    const pid = String(payload.pid);
    if (st.picks.some((p) => p.pid === pid)) return;
    out.push({
      seq: nextSeq(),
      type,
      payload: {
        pid, overall: cur, round: roundOf(config, cur),
        slot: ownerOf(config, st, cur), is_keeper: false,
      },
    });
    applyDueKeepers(config, realEvents, out);
  } else {
    // v1's mock undo: rewind to just before YOUR most recent pick when it's
    // within the last round (bots pause; you re-pick); otherwise pop the
    // trailing keeper fills plus the last real pick.
    stopBots();
    const picks = st.picks;
    if (!picks.length) return;
    const lastMine = picks.map((p) => p.slot).lastIndexOf(mySlot);
    let keep: number;
    if (lastMine >= 0 && picks.length - lastMine <= config.teams) {
      keep = lastMine;
    } else {
      keep = picks.length;
      while (keep > 0 && picks[keep - 1]!.is_keeper) keep--;
      if (keep > 0) keep--;
    }
    while (keep > 0 && picks[keep - 1]!.is_keeper) keep--;
    for (let i = picks.length - 1; i >= keep; i--) {
      out.push({ seq: nextSeq() + out.length, type: 'pick_undone', payload: { overall: picks[i]!.overall } });
    }
  }

  if (out.length) emit({ local: [...store.local, ...out] });
}

export function setSpeed(ms: number): void {
  emit({ speed: ms });
  if (store.running) {
    stopBots();
    startBots(lastBotArgs!.players, lastBotArgs!.byPid, lastBotArgs!.config, lastBotArgs!.realEvents, lastBotArgs!.mySlot);
  }
}

interface BotArgs {
  players: PoolPlayer[]; byPid: Map<string, PoolPlayer>;
  config: SeasonConfig; realEvents: DraftEvent[]; mySlot: number;
}
let lastBotArgs: BotArgs | null = null;

export function startBots(
  players: PoolPlayer[], byPid: Map<string, PoolPlayer>,
  config: SeasonConfig, realEvents: DraftEvent[], mySlot: number,
): void {
  if (store.running) return;
  lastBotArgs = { players, byPid, config, realEvents, mySlot };
  mockSubmit(config, realEvents, mySlot, 'draft_started');
  emit({ running: true });
  timer = setInterval(() => {
    const st = mockState(realEvents);
    if (st.picks.length >= config.teams * config.rounds) { stopBots(); return; }
    const cur = st.picks.length + 1;
    if (ownerOf(config, st, cur) === mySlot) return; // paused on your pick
    const pid = botPick(players, byPid, config, st, cur);
    if (!pid) { stopBots(); return; }
    mockSubmit(config, realEvents, mySlot, 'pick_made', { pid });
  }, store.speed);
}

export function stopBots(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (store.running) emit({ running: false });
}

export function resetMock(): void {
  stopBots();
  emit({ local: [] });
}
