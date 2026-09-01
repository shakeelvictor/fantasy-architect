// Reference data: the baked player pool (static JSON, same model as v1's
// daily Netlify bake). Everything stateful lives behind src/transport.ts;
// the pool's own shapes live in ./pool so Node tools can use them too.

export type { MflSetup, Session, SubmitResult } from './transport';
export { SEASON, transport } from './transport';

export type { PoolPlayer, PoolDoc } from './pool';
import type { PoolDoc } from './pool';

export async function fetchPool(): Promise<PoolDoc> {
  return (await (await fetch('/players.json')).json()) as PoolDoc;
}
