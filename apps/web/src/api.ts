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
}

export async function fetchPlayers(): Promise<PoolPlayer[]> {
  const d = (await (await fetch('/players.json')).json()) as { players: PoolPlayer[] };
  return d.players;
}
