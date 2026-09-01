// POST { season, pin } → { token, role, slot } | 401.
//
// The one place PINs are checked. Reads the pins table with the service
// role (clients have no path to it — RLS with zero policies), compares
// sha256(salt || pin), and mints a 24h HS256 JWT carrying app_role/app_slot.
// A wrong PIN costs a flat 600ms, v1's politeness throttle.
//
// Secrets (supabase secrets set): FA_JWT_SECRET — the project's legacy JWT
// secret, so PostgREST accepts the tokens. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

import { mintJwt, sha256Hex } from './jwt.ts';

interface PinRow {
  role: 'commish' | 'team';
  slot: number | null;
  salt: string;
  pin_hash: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'content-type': 'application/json',
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('{"error":"POST only"}', { status: 405, headers: CORS });

  let body: { season?: number; pin?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('{"error":"bad json"}', { status: 400, headers: CORS });
  }
  const pin = String(body.pin ?? '');
  const season = Number(body.season);
  if (!pin || !season) return new Response('{"error":"season and pin required"}', { status: 400, headers: CORS });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const rows: PinRow[] = await fetch(
    `${url}/rest/v1/pins?season=eq.${season}&select=role,slot,salt,pin_hash`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } },
  ).then((r) => r.json());

  let match: PinRow | null = null;
  for (const row of rows) {
    if ((await sha256Hex(row.salt + pin)) === row.pin_hash) {
      match = row;
      break;
    }
  }

  if (!match) {
    await new Promise((r) => setTimeout(r, 600)); // flat-rate wrong-guess tax
    return new Response('{"error":"wrong PIN"}', { status: 401, headers: CORS });
  }

  const token = await mintJwt(
    { app_role: match.role, app_slot: match.slot },
    Deno.env.get('FA_JWT_SECRET')!,
  );
  return new Response(JSON.stringify({ token, role: match.role, slot: match.slot }), { headers: CORS });
});
