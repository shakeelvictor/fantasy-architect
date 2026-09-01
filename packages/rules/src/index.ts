// The shared draft-state reducer. Every client folds the same event log the
// server appends to; this reducer mirrors the SQL fold (fa_fold in
// 0001_foundation.sql) case for case, and the integration suite asserts the
// two produce identical state over a full scripted draft. Change one, change
// both — the test will hold you to it.

export interface SeasonConfig {
  teams: number;
  rounds: number;
  type: 'linear' | 'snake';
  order?: string[];
}

export interface Pick {
  pid: string;
  overall: number;
  round: number;
  slot: number;
  is_keeper: boolean;
  via_request?: number;
}

export interface Keeper {
  pid: string;
  slot: number;
  round: number;
}

export interface Trade {
  round: number;
  from_slot: number;
  to_slot: number;
}

export interface PickRequest {
  pid: string;
  slot: number;
  seq: number;
  resolved: boolean;
  accepted?: boolean;
}

export type DraftEventType =
  | 'draft_started'
  | 'pick_requested'
  | 'pick_request_resolved'
  | 'pick_made'
  | 'pick_undone'
  | 'keeper_declared'
  | 'keeper_removed'
  | 'pick_traded'
  | 'trade_reverted'
  | 'player_moved'
  | 'draft_completed';

export interface DraftEvent {
  seq: number;
  type: DraftEventType;
  payload: Record<string, unknown>;
}

export interface DraftState {
  started: boolean;
  completed: boolean;
  picks: Pick[];
  keepers: Keeper[];
  trades: Trade[];
  requests: PickRequest[];
}

export function initialState(): DraftState {
  return { started: false, completed: false, picks: [], keepers: [], trades: [], requests: [] };
}

// ---------------------------------------------------------- board math
// Ports v1's overallForSlotRound / slotForOverall exactly.

export function overallFor(config: SeasonConfig, slot: number, round: number): number {
  const idx = config.type === 'snake' && round % 2 === 0 ? config.teams - slot : slot - 1;
  return (round - 1) * config.teams + idx + 1;
}

export function boardSlot(config: SeasonConfig, overall: number): number {
  const round = Math.floor((overall - 1) / config.teams) + 1;
  const idx = (overall - 1) % config.teams;
  return config.type === 'snake' && round % 2 === 0 ? config.teams - idx : idx + 1;
}

export function roundOf(config: SeasonConfig, overall: number): number {
  return Math.floor((overall - 1) / config.teams) + 1;
}

export function ownerOf(config: SeasonConfig, state: DraftState, overall: number): number {
  const slot = boardSlot(config, overall);
  const round = roundOf(config, overall);
  const trade = state.trades.find((t) => t.round === round && t.from_slot === slot);
  return trade ? trade.to_slot : slot;
}

export function currentOverall(state: DraftState): number {
  return state.picks.length + 1;
}

// ------------------------------------------------------------ the fold

export function applyEvent(state: DraftState, e: DraftEvent): DraftState {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case 'draft_started':
      return { ...state, started: true };
    case 'draft_completed':
      return { ...state, completed: true };
    case 'pick_made':
      return { ...state, picks: [...state.picks, p as unknown as Pick] };
    case 'pick_undone':
      return { ...state, picks: state.picks.filter((x) => x.overall !== (p as unknown as { overall: number }).overall) };
    case 'keeper_declared': {
      const k = p as unknown as Keeper;
      return { ...state, keepers: [...state.keepers.filter((x) => x.pid !== k.pid), k] };
    }
    case 'keeper_removed':
      return { ...state, keepers: state.keepers.filter((x) => x.pid !== (p as unknown as { pid: string }).pid) };
    case 'pick_traded': {
      const t = p as unknown as Trade;
      return {
        ...state,
        trades: [
          ...state.trades.filter((x) => !(x.round === t.round && x.from_slot === t.from_slot)),
          t,
        ],
      };
    }
    case 'trade_reverted': {
      const t = p as unknown as Trade;
      return {
        ...state,
        trades: state.trades.filter((x) => !(x.round === t.round && x.from_slot === t.from_slot)),
      };
    }
    case 'pick_requested': {
      const r = p as unknown as { pid: string; slot: number };
      return {
        ...state,
        requests: [...state.requests, { pid: r.pid, slot: r.slot, seq: e.seq, resolved: false }],
      };
    }
    case 'pick_request_resolved': {
      const r = p as unknown as { request_seq: number; accepted: boolean };
      return {
        ...state,
        requests: state.requests.map((x) =>
          x.seq === r.request_seq ? { ...x, resolved: true, accepted: r.accepted } : x,
        ),
      };
    }
    case 'player_moved':
      return state; // post-draft roster reshaping; no fold state yet
  }
}

export function foldEvents(events: readonly DraftEvent[]): DraftState {
  let state = initialState();
  for (const e of events) state = applyEvent(state, e);
  return state;
}
