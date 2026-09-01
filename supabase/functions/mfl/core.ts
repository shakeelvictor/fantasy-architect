// MyFantasyLeague integration core — v1's lib/mfl.js, ported whole:
// Sleeper→MFL player ID mapping (name/team/pos with nickname + edge-rusher
// fallbacks), draftResults XML builder, commissioner login + import push.
//
// Platform-neutral on purpose (fetch only, no Deno/Node APIs): the Supabase
// edge function AND tools/dev-api both import this file, the same way both
// share auth-pin/jwt.ts. MFL has no CORS, so the browser can never talk to
// it directly — every call here runs server-side.
//
// MFL has no roster-import API; rosters are populated by importing draft
// results (import?TYPE=draftResults). NOTE: XML=1 goes in the QUERY STRING
// ONLY — sending it in the POST body as well makes MFL reject the request
// with "Field login XML: Must Be Less Than 1 Characters Long" before it
// ever checks the credentials (v1's hard-won lesson).

// ------------------------------------------------------- who may push
//
// Pushing rewrites the real league: MFL's import REPLACES every existing
// draft result, for whatever season it is aimed at. It is the most
// destructive thing this app can reach, so the rule that guards it lives
// HERE, in the module both the edge function and tools/dev-api already
// share, rather than being hand-rolled either side of the wire. Two copies
// of a security check are two copies to keep in step, and the one that
// drifts is the one nobody notices.

import { verifyJwt } from '../auth-pin/jwt.ts';

export type PushAuth =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/** Commissioner-only, for every season, now and in future years. Nothing here
 *  is year-specific: the claim is a ROLE, so a 2028 commissioner passes and a
 *  2028 team does not, with no code change in between. */
export async function authorizePush(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): Promise<PushAuth> {
  // Fail CLOSED on a missing secret. `verifyJwt(token, '')` happily verifies
  // a token signed with the empty string, so a secret that goes missing —
  // rotated, mistyped, a fresh project without it set — would turn this from
  // commissioner-only into anyone-only, silently and at exactly the moment
  // nobody is looking.
  if (!secret) {
    return { ok: false, status: 500, error: 'server is missing its signing secret; refusing to push' };
  }
  const token = (authorizationHeader ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 403, error: 'commissioner only' };

  // verifyJwt THROWS on a malformed token rather than returning null (its
  // base64 decode gives up on junk), which would surface as a 500 — an
  // ambiguous answer to an unambiguous question. Anything that is not a
  // verified token is a refusal, so treat a throw as one.
  let claims: Record<string, unknown> | null = null;
  try {
    claims = await verifyJwt(token, secret);
  } catch {
    claims = null;
  }
  // covers a forged, tampered or malformed token AND an expired session,
  // since verifyJwt checks exp — a stale tab must not still be able to push
  if (!claims) return { ok: false, status: 403, error: 'session is invalid or expired' };
  if (claims.app_role !== 'commish') return { ok: false, status: 403, error: 'commissioner only' };
  return { ok: true, claims };
}

export const MFL_LEAGUE_ID = '19716';
const MFL_HOST = 'https://www44.myfantasyleague.com';
const MFL_API_HOST = 'https://api.myfantasyleague.com';

// Sleeper team code -> MFL team code (identical codes omitted)
const TEAM_MAP: Record<string, string> = {
  GB: 'GBP', JAX: 'JAC', KC: 'KCC', LV: 'LVR',
  NE: 'NEP', NO: 'NOS', SF: 'SFO', TB: 'TBB',
};

// position compatibility: sleeper pos -> acceptable MFL positions
const POS_MAP: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['PK'],
  DL: ['DT', 'DE'], LB: ['LB'], DB: ['CB', 'S'],
};

// IDP edge players are coded inconsistently (LB vs DE), so relax there
const RELAXED_POS: Record<string, string[]> = {
  ...POS_MAP,
  LB: ['LB', 'DE', 'DT'], DL: ['DT', 'DE', 'LB'], DB: ['CB', 'S', 'LB'],
};

export interface AppPlayer { id: string; name: string; pos: string; team: string | null }
interface MflPlayer { id: string; name?: string; position?: string; team?: string }

function normName(name: string): string {
  return String(name).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’\-]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': 'fantasy-architect/2.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

let mflPlayersCache: { at: number; season: string; data: MflPlayer[] | null } = { at: 0, season: '', data: null };
async function getMflPlayers(season: string): Promise<MflPlayer[]> {
  if (mflPlayersCache.data && mflPlayersCache.season === season
    && Date.now() - mflPlayersCache.at < 12 * 3600 * 1000) {
    return mflPlayersCache.data;
  }
  const d = await fetchJson<{ players: { player: MflPlayer[] } }>(
    `${MFL_API_HOST}/${season}/export?TYPE=players&JSON=1`);
  mflPlayersCache = { at: Date.now(), season, data: d.players.player };
  return d.players.player;
}

export async function getMflLeague(season: string, leagueId?: string | undefined): Promise<{
  name: string; franchises: { franchise: { id: string; name: string }[] };
}> {
  const d = await fetchJson<{ league: { name: string; franchises: { franchise: { id: string; name: string }[] } } }>(
    `${MFL_HOST}/${season}/export?TYPE=league&L=${leagueId || MFL_LEAGUE_ID}&JSON=1`);
  return d.league;
}

// Map app players ({id, name, pos, team}) to MFL ids.
export async function buildIdMap(season: string, appPlayers: AppPlayer[]): Promise<{
  map: Record<string, string>; unmatched: AppPlayer[];
}> {
  const mfl = await getMflPlayers(season);
  const byName: Record<string, MflPlayer[]> = {};
  const byLast: Record<string, MflPlayer[]> = {};
  for (const m of mfl) {
    if (!m.name) continue;
    const [last, first] = m.name.split(',').map((s) => (s || '').trim());
    const key = normName(`${first} ${last}`);
    (byName[key] = byName[key] ?? []).push(m);
    const lastKey = normName(last ?? '');
    (byLast[lastKey] = byLast[lastKey] ?? []).push(m);
  }
  const map: Record<string, string> = {};
  const unmatched: AppPlayer[] = [];
  for (const p of appPlayers) {
    const key = normName(p.name);
    const cands = byName[key] ?? [];
    const mflTeam = TEAM_MAP[p.team ?? ''] ?? p.team;
    const okPos = POS_MAP[p.pos] ?? [p.pos];
    const relaxedPos = RELAXED_POS[p.pos] ?? okPos;
    let hit =
      cands.find((c) => c.team === mflTeam && okPos.includes(c.position ?? '')) ||
      cands.find((c) => okPos.includes(c.position ?? '')) ||
      cands.find((c) => c.team === mflTeam && relaxedPos.includes(c.position ?? '')) ||
      (cands.length === 1 ? cands[0] : null);
    if (!hit) {
      // nickname fallback: unique last-name + team + compatible position
      // (Kenny/Kenneth Gainwell, Chig/Chigoziem Okonkwo, Riq/Tariq Woolen…)
      const lastKey = normName(p.name.split(' ').slice(1).join(' ') || p.name);
      const lastCands = (byLast[lastKey] ?? []).filter(
        (c) => c.team === mflTeam && relaxedPos.includes(c.position ?? ''));
      if (lastCands.length === 1) hit = lastCands[0];
    }
    if (hit) map[p.id] = hit.id;
    else unmatched.push(p);
  }
  return { map, unmatched };
}

// Log in and return the session cookie header value. Credentials pass
// straight through to MFL over HTTPS and are never stored.
async function mflLogin(season: string, username: string, password: string): Promise<string> {
  const loginRes = await fetch(`${MFL_API_HOST}/${season}/login?XML=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ USERNAME: username, PASSWORD: password }).toString(),
  });
  const loginBody = await loginRes.text();

  const errMatch = loginBody.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
  if (errMatch) throw new Error('MFL rejected the login: ' + errMatch[1]!.trim());

  const setCookie = typeof (loginRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (loginRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie().join('; ')
    : (loginRes.headers.get('set-cookie') ?? '');
  const token = (setCookie.match(/MFL_USER_ID=([^;,\s]+)/) ||
    loginBody.match(/MFL_USER_ID\s*=\s*"?([^"'\s>;]+)"?/i) || [])[1];
  if (!token) {
    throw new Error('MFL accepted the login but returned no session id. Response: ' + loginBody.slice(0, 200));
  }
  return `MFL_USER_ID=${token}`;
}

export async function pushDraftResults(args: {
  season: string; leagueId?: string | undefined; username: string; password: string; xml: string;
}): Promise<{ status: number; response: string }> {
  const cookie = await mflLogin(args.season, args.username, args.password);
  const importRes = await fetch(
    `${MFL_HOST}/${args.season}/import?TYPE=draftResults&L=${args.leagueId || MFL_LEAGUE_ID}&XML=1`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ DATA: args.xml }).toString(),
    },
  );
  const body = await importRes.text();
  if (/<error/i.test(body)) throw new Error('MFL import error: ' + body.slice(0, 300));
  return { status: importRes.status, response: body.slice(0, 500) };
}
