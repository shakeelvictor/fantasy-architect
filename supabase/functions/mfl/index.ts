// The MFL proxy — MFL has no CORS, so the browser can't talk to it; this
// function does, with v1's exact protocol (core.ts). Two operations:
//
//   POST { op:'setup', season?, leagueId?, players:[{id,name,pos,team}] }
//     → { leagueName, franchises:[{id,name}], map:{sleeperId:mflId}, unmatched }
//     The client sends only the players it needs mapped (the drafted ones) —
//     public MFL data in, public MFL data out, so no auth required.
//
//   POST { op:'push', season?, leagueId?, username, password, xml }
//     → { status, response }
//     THE call that rewrites the real league: requires a commissioner JWT
//     (verified with FA_JWT_SECRET, same crypto as auth-pin). Credentials
//     pass straight through to MFL over HTTPS and are never stored/logged.
//
// The MFL site year defaults to the current league season; pass `season`
// to point at a different MFL year.

import { authorizePush, buildIdMap, getMflLeague, pushDraftResults, type AppPlayer } from './core.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'content-type': 'application/json',
};

const err = (status: number, msg: string): Response =>
  new Response(JSON.stringify({ error: msg }), { status, headers: CORS });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return err(405, 'POST only');

  let body: {
    op?: string; season?: string | number; leagueId?: string;
    players?: AppPlayer[]; username?: string; password?: string; xml?: string;
  };
  try {
    body = await req.json();
  } catch {
    return err(400, 'bad json');
  }
  const season = String(body.season ?? new Date().getFullYear());

  try {
    if (body.op === 'setup') {
      const players = Array.isArray(body.players) ? body.players : [];
      const [league, idMap] = await Promise.all([
        getMflLeague(season, body.leagueId),
        buildIdMap(season, players),
      ]);
      const franchises = league.franchises.franchise.map((f) => ({ id: f.id, name: f.name }));
      return new Response(
        JSON.stringify({ leagueName: league.name, franchises, ...idMap }),
        { headers: CORS },
      );
    }

    if (body.op === 'push') {
      // the one call that rewrites the real league — commissioner JWT only,
      // decided by the shared rule in core.ts so this and dev-api cannot drift
      const auth = await authorizePush(
        req.headers.get('authorization'),
        Deno.env.get('FA_JWT_SECRET'),
      );
      if (!auth.ok) return err(auth.status, auth.error);
      if (!body.username || !body.password || !body.xml) {
        return err(400, 'username, password, and xml are required');
      }
      const result = await pushDraftResults({
        season, leagueId: body.leagueId,
        username: body.username, password: body.password, xml: body.xml,
      });
      return new Response(JSON.stringify(result), { headers: CORS });
    }

    return err(400, 'unknown op');
  } catch (e) {
    return err(500, String((e as Error).message ?? e));
  }
});
