// Who may push draft results to MyFantasyLeague.
//
// This is the most destructive call the app can reach: MFL's import REPLACES
// every existing draft result in the league. The rule is commissioner-only,
// it has to hold for 2027, 2028 and every year after, and until now it was
// hand-rolled in two places and tested in none.
//
// Runs under Node exactly as it will under Deno — the crypto is Web Crypto
// and core.ts touches nothing platform-specific.

import { describe, expect, it } from 'vitest';
import { mintJwt } from '../../../supabase/functions/auth-pin/jwt.ts';
import { authorizePush } from '../../../supabase/functions/mfl/core.ts';

const SECRET = 'test-secret';
const bearer = (t: string): string => `Bearer ${t}`;
const now = Math.floor(Date.now() / 1000);

describe('MFL push is commissioner-only', () => {
  it('lets a commissioner through', async () => {
    const token = await mintJwt({ app_role: 'commish', app_slot: null }, SECRET);
    const r = await authorizePush(bearer(token), SECRET);
    expect(r.ok).toBe(true);
  });

  it('refuses a team, however valid its session', async () => {
    const token = await mintJwt({ app_role: 'team', app_slot: 2 }, SECRET);
    const r = await authorizePush(bearer(token), SECRET);
    expect(r).toMatchObject({ ok: false, status: 403, error: 'commissioner only' });
  });

  it('refuses a spectator with no token at all', async () => {
    expect(await authorizePush(null, SECRET)).toMatchObject({ ok: false, status: 403 });
    expect(await authorizePush('', SECRET)).toMatchObject({ ok: false, status: 403 });
    expect(await authorizePush('Bearer ', SECRET)).toMatchObject({ ok: false, status: 403 });
  });

  // found by the e2e: verifyJwt throws on junk instead of returning null, so
  // this used to come back 500 — an ambiguous answer to a question that has
  // an unambiguous one
  it('refuses garbage without falling over', async () => {
    for (const junk of ['not.a.token', 'Bearer', 'a.b', '...', '%%%.%%%.%%%']) {
      expect(await authorizePush(bearer(junk), SECRET)).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('refuses a token signed with the wrong secret', async () => {
    const forged = await mintJwt({ app_role: 'commish', app_slot: null }, 'not-the-secret');
    expect(await authorizePush(bearer(forged), SECRET))
      .toMatchObject({ ok: false, status: 403, error: 'session is invalid or expired' });
  });

  it('refuses an expired commissioner session — a stale tab cannot push', async () => {
    // minted 25h ago; the gate is an absolute 24h window
    const stale = await mintJwt({ app_role: 'commish', app_slot: null }, SECRET, now - 25 * 3600);
    expect(await authorizePush(bearer(stale), SECRET)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a payload edited to claim commish without resigning', async () => {
    const token = await mintJwt({ app_role: 'team', app_slot: 2 }, SECRET);
    const [h, , sig] = token.split('.');
    const payload = Buffer.from(JSON.stringify({
      role: 'authenticated', app_role: 'commish', app_slot: null, iat: now, exp: now + 3600,
    })).toString('base64url');
    expect(await authorizePush(bearer(`${h}.${payload}.${sig}`), SECRET))
      .toMatchObject({ ok: false, status: 403 });
  });

  // The fail-open that mattered most: verifyJwt(token, '') happily verifies a
  // token signed with the empty string. A secret that goes missing — rotated,
  // mistyped, a fresh project without it set — would turn commissioner-only
  // into anyone-only, silently, at exactly the moment nobody is looking.
  it('refuses everything when the server has no signing secret', async () => {
    const real = await mintJwt({ app_role: 'commish', app_slot: null }, SECRET);
    expect(await authorizePush(bearer(real), undefined))
      .toMatchObject({ ok: false, status: 500 });
    expect(await authorizePush(bearer(real), ''))
      .toMatchObject({ ok: false, status: 500 });

    // Web Crypto happens to refuse a zero-length HMAC key, so the matching
    // forgery cannot even be built with this crypto — but that is an accident
    // of the primitive, not a decision, and it would not hold for an attacker
    // using a different library. The guard above is what actually closes it.
    await expect(mintJwt({ app_role: 'commish', app_slot: null }, ''))
      .rejects.toThrow();
  });

  it('is a role rule, not a season rule — it holds for future years unchanged', async () => {
    // claims carry app_role/app_slot only; nothing here is year-specific, so
    // a 2028 commissioner passes and a 2028 team does not, with no code change
    const commish = await mintJwt({ app_role: 'commish', app_slot: null }, SECRET);
    const team = await mintJwt({ app_role: 'team', app_slot: 11 }, SECRET);
    expect((await authorizePush(bearer(commish), SECRET)).ok).toBe(true);
    expect((await authorizePush(bearer(team), SECRET)).ok).toBe(false);
  });
});
