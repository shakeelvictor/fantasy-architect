// Reference data: the baked player pool (static JSON, same model as v1's
// daily Netlify bake). Everything stateful lives behind src/transport.ts.

export type { Session, SubmitResult } from './transport';
export { SEASON, transport } from './transport';

export interface PoolPlayer {
  pid: string;
  name: string;
  pos: string;
  group: string;
  team: string | null;
  proj: number;
  adp: number | null;
  bye: number | null;
  sos: number | null;
  po: number | null;
  interest: number | null;
  injury: string | null;
  stats: Record<string, number> | null;
  posRank?: number;
  vorp?: number;
  tier?: number;
  overallRank?: number;
  // player-card fields — absent from a players.json baked before the drawer
  // shipped, so the card renders what it has and shows dashes for the rest
  ppg?: number;
  opps?: Record<number, string | null>;
  weekPts?: Record<number, number>;
  playoffOpps?: { week: number; opp: string }[];
  injuryPart?: string | null;
  injuryNotes?: string | null;
  newsUpdated?: number | null;
  depthOrder?: number | null;
  depthPos?: string | null;
  yearsExp?: number | null;
  age?: number | null;
  height?: string | null;
  weight?: string | null;
  college?: string | null;
  number?: number | null;
  lastSeason?: number | null;
  lastSeasonRank?: number | null;
}

export interface PoolDoc {
  bakedAt: string;
  season: string;
  prior?: string;
  sosRanks?: Record<string, Record<string, number>>;
  players: PoolPlayer[];
}

export async function fetchPool(): Promise<PoolDoc> {
  return (await (await fetch('/players.json')).json()) as PoolDoc;
}
