// Local stand-in for the Supabase platform, for development and e2e tests:
// the REAL migration running in PGlite, the REAL RLS enforced per request
// (SET ROLE anon/authenticated + request.jwt.claims, exactly as PostgREST
// executes queries), the REAL auth-pin JWT crypto — plus SSE standing in for
// Supabase Realtime. The web app talks to this through the same shapes it
// will use against the hosted platform; swapping is a transport change.
//
//   POST /auth                  {season, pin} → {token, role, slot}
//   GET  /bootstrap?season=     {config, events}          (as anon)
//   GET  /events?season=&since= {events}                  (as anon)
//   GET  /stream?season=&since= SSE, one event per line   (as anon)
//   POST /rpc/submit_event      Bearer token, {season, key, type, payload}
//   POST /rpc/set_season_config Bearer token, {season, config}   (commish)

import { PGlite } from '@electric-sql/pglite';
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintJwt, sha256Hex, verifyJwt } from '../../../supabase/functions/auth-pin/jwt.ts';
import * as mflCore from '../../../supabase/functions/mfl/core.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = Number(process.env.PORT ?? 8787);
const SEASON = 2027;
const JWT_SECRET = 'fa2-dev-secret';
const ORDER = ['Anand', 'Vip', 'Andres', 'Ryaan', 'Dante', 'Hoss', 'Asher', 'Imran', 'Samson', 'Laura', 'Shak'];

// dev PINs: commissioner 1111, team slot N → 2200 + N (2201…2211)
const PINS: { role: 'commish' | 'team'; slot: number | null; pin: string }[] = [
  { role: 'commish', slot: null, pin: '1111' },
  ...ORDER.map((_, i) => ({ role: 'team' as const, slot: i + 1, pin: String(2200 + i + 1) })),
];

const SEED_CONFIG = { teams: ORDER.length, rounds: 20, type: 'linear', order: ORDER };

const db = new PGlite();
// PGlite is a single connection — serialize everything that touches it.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

type Identity = { role: 'anon' } | { role: 'authenticated'; app_role: string; app_slot: number | null };

async function asIdentity<T>(id: Identity, fn: () => Promise<T>): Promise<T> {
  try {
    if (id.role === 'anon') {
      await db.exec(`set role anon; select set_config('request.jwt.claims', '', false);`);
    } else {
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ role: 'authenticated', app_role: id.app_role, app_slot: id.app_slot }),
      ]);
      await db.exec(`set role authenticated;`);
    }
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

async function boot(): Promise<void> {
  await db.exec(readFileSync(join(ROOT, 'supabase', 'dev', 'shim.sql'), 'utf8'));
  await db.exec(readFileSync(join(ROOT, 'supabase', 'migrations', '0001_foundation.sql'), 'utf8'));
  await db.exec(readFileSync(join(ROOT, 'supabase', 'migrations', '0003_season_config.sql'), 'utf8'));
  await db.exec(readFileSync(join(ROOT, 'supabase', 'migrations', '0004_config_error_message.sql'), 'utf8'));
  await db.exec(readFileSync(join(ROOT, 'supabase', 'migrations', '0005_freeze_on_coordinates.sql'), 'utf8'));
  await db.exec(readFileSync(join(ROOT, 'supabase', 'dev', 'grants.sql'), 'utf8'));
  await db.query(`insert into seasons (year, config) values ($1, $2)`, [SEASON, JSON.stringify(SEED_CONFIG)]);
  for (const [i, owner] of ORDER.entries()) {
    await db.query(`insert into teams (season, slot, owner) values ($1, $2, $3)`, [SEASON, i + 1, owner]);
  }
  for (const p of PINS) {
    const salt = `dev-${p.role}-${p.slot ?? 0}`;
    await db.query(
      `insert into pins (season, role, slot, salt, pin_hash) values ($1, $2, $3, $4, $5)`,
      [SEASON, p.role, p.slot, salt, await sha256Hex(salt + p.pin)],
    );
  }
}

interface Ev { seq: number; type: string; actor: unknown; payload: unknown }

async function eventsSince(season: number, since: number): Promise<Ev[]> {
  return asIdentity({ role: 'anon' }, async () => {
    const r = await db.query<{ seq: string | number; type: string; actor: unknown; payload: unknown }>(
      `select seq, type, actor, payload from draft_events where season = $1 and seq > $2 order by seq`,
      [season, since],
    );
    return r.rows.map((x) => ({ ...x, seq: Number(x.seq) }));
  });
}

// ------------------------------------------------------------- SSE fan-out
const subscribers = new Map<ServerResponse, { season: number; last: number }>();

async function broadcast(season: number): Promise<void> {
  const tops = [...subscribers.entries()].filter(([, s]) => s.season === season);
  if (!tops.length) return;
  const floor = Math.min(...tops.map(([, s]) => s.last));
  const fresh = await eventsSince(season, floor);
  for (const [res, sub] of tops) {
    for (const e of fresh) {
      if (e.seq > sub.last) {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
        sub.last = e.seq;
      }
    }
  }
}

// ------------------------------------------------------------------ server
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const season = Number(url.searchParams.get('season') ?? SEASON);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
      });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/auth') {
      const body = JSON.parse(await readBody(req)) as { season?: number; pin?: string };
      const pin = String(body.pin ?? '');
      const rows = await exclusive(() =>
        db.query<{ role: 'commish' | 'team'; slot: number | null; salt: string; pin_hash: string }>(
          `select role, slot, salt, pin_hash from pins where season = $1`,
          [body.season ?? SEASON],
        ),
      );
      for (const row of rows.rows) {
        if ((await sha256Hex(row.salt + pin)) === row.pin_hash) {
          const token = await mintJwt({ app_role: row.role, app_slot: row.slot }, JWT_SECRET);
          return json(res, 200, { token, role: row.role, slot: row.slot });
        }
      }
      await new Promise((r) => setTimeout(r, 300));
      return json(res, 401, { error: 'wrong PIN' });
    }

    if (req.method === 'POST' && url.pathname === '/reset') {
      // e2e isolation only: wipe the season's log AND put its config back to
      // the seed (superuser, bypasses RLS — exactly what production must never
      // allow, which is why this endpoint exists only in the dev server).
      // The config restore matters because the settings screen can change it,
      // and one Playwright run shares this server across every spec.
      await exclusive(async () => {
        await db.query(`delete from draft_events where season = $1`, [season]);
        await db.query(`update seasons set config = $2 where year = $1`, [season, JSON.stringify(SEED_CONFIG)]);
        await db.query(`delete from teams where season = $1`, [season]);
        for (const [i, owner] of ORDER.entries()) {
          await db.query(`insert into teams (season, slot, owner) values ($1, $2, $3)`, [season, i + 1, owner]);
        }
      });
      return json(res, 200, { reset: true });
    }

    if (req.method === 'GET' && url.pathname === '/bootstrap') {
      const [config, events] = await exclusive(async () => {
        const c = await asIdentity({ role: 'anon' }, () =>
          db.query<{ config: unknown }>(`select config from seasons where year = $1`, [season]),
        );
        return [c.rows[0]?.config, await eventsSince(season, 0)] as const;
      });
      return json(res, 200, { config, events });
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return json(res, 200, { events: await exclusive(() => eventsSince(season, since)) });
    }

    if (req.method === 'GET' && url.pathname === '/stream') {
      const since = Number(url.searchParams.get('since') ?? 0);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'access-control-allow-origin': '*',
      });
      // flush headers immediately or EventSource never fires onopen,
      // and keep intermediaries from timing the idle stream out
      res.write(': hello\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      const backlog = await exclusive(() => eventsSince(season, since));
      let last = since;
      for (const e of backlog) {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
        last = e.seq;
      }
      subscribers.set(res, { season, last });
      req.on('close', () => {
        clearInterval(ping);
        subscribers.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/rpc/submit_event') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const claims = await verifyJwt(token, JWT_SECRET);
      if (!claims) return json(res, 401, { error: 'invalid or expired token' });
      const body = JSON.parse(await readBody(req)) as {
        season: number; key: string; type: string; payload?: unknown;
      };
      try {
        const result = await exclusive(() =>
          asIdentity(
            { role: 'authenticated', app_role: String(claims.app_role), app_slot: (claims.app_slot as number | null) ?? null },
            async () => {
              const r = await db.query<{ submit_event: unknown }>(
                `select submit_event($1, $2, $3, $4)`,
                [body.season, body.key, body.type, JSON.stringify(body.payload ?? {})],
              );
              return r.rows[0]!.submit_event;
            },
          ),
        );
        await exclusive(() => broadcast(body.season));
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: (e as Error).message.replace(/^.*?:\s*/, '') });
      }
    }

    if (req.method === 'POST' && url.pathname === '/rpc/set_season_config') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const claims = await verifyJwt(token, JWT_SECRET);
      if (!claims) return json(res, 401, { error: 'invalid or expired token' });
      const body = JSON.parse(await readBody(req)) as { season: number; config: unknown };
      try {
        const result = await exclusive(() =>
          asIdentity(
            { role: 'authenticated', app_role: String(claims.app_role), app_slot: (claims.app_slot as number | null) ?? null },
            async () => {
              const r = await db.query<{ set_season_config: unknown }>(
                `select set_season_config($1, $2)`,
                [body.season, JSON.stringify(body.config)],
              );
              return r.rows[0]!.set_season_config;
            },
          ),
        );
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: (e as Error).message.replace(/^.*?:\s*/, '') });
      }
    }

    if (req.method === 'POST' && url.pathname === '/mfl') {
      // same handler shape as the hosted mfl edge function, sharing its core
      const body = JSON.parse(await readBody(req)) as {
        op?: string; season?: string | number; leagueId?: string;
        players?: import('../../../supabase/functions/mfl/core.ts').AppPlayer[];
        username?: string; password?: string; xml?: string;
      };
      const mflSeason = String(body.season ?? SEASON);
      try {
        if (body.op === 'setup') {
          const [league, idMap] = await Promise.all([
            mflCore.getMflLeague(mflSeason, body.leagueId),
            mflCore.buildIdMap(mflSeason, body.players ?? []),
          ]);
          return json(res, 200, {
            leagueName: league.name,
            franchises: league.franchises.franchise.map((f) => ({ id: f.id, name: f.name })),
            ...idMap,
          });
        }
        if (body.op === 'push') {
          // the same shared rule the hosted edge function applies
          const auth = await mflCore.authorizePush(req.headers.authorization, JWT_SECRET);
          if (!auth.ok) return json(res, auth.status, { error: auth.error });
          if (!body.username || !body.password || !body.xml) {
            return json(res, 400, { error: 'username, password, and xml are required' });
          }
          return json(res, 200, await mflCore.pushDraftResults({
            season: mflSeason, leagueId: body.leagueId,
            username: body.username, password: body.password, xml: body.xml,
          }));
        }
        return json(res, 400, { error: 'unknown op' });
      } catch (e) {
        return json(res, 500, { error: String((e as Error).message ?? e) });
      }
    }

    json(res, 404, { error: 'not found' });
  })().catch((e) => json(res, 500, { error: String(e) }));
});

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s || '{}'));
    req.on('error', reject);
  });
}

await boot();
server.listen(PORT, () => {
  console.log(`[dev-api] season ${SEASON} on :${PORT} — commish PIN 1111, team PINs 2201–2211`);
});
