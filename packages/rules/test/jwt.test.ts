// The auth-pin function's crypto is pure Web Crypto, so it runs under Node
// exactly as it will under Deno — these tests pin the claim shape PostgREST
// and fa_role()/fa_slot() depend on.

import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, mintJwt, sha256Hex } from '../../../supabase/functions/auth-pin/jwt.ts';

describe('auth-pin jwt', () => {
  it('mints Supabase-compatible claims: role=authenticated + app_role/app_slot', async () => {
    const token = await mintJwt({ app_role: 'team', app_slot: 7 }, 'test-secret', 1_700_000_000);
    const claims = decodeJwtPayload(token);
    expect(claims).toMatchObject({
      role: 'authenticated',
      aud: 'authenticated',
      app_role: 'team',
      app_slot: 7,
      iat: 1_700_000_000,
      exp: 1_700_000_000 + 86_400, // absolute 24h, v1's gate semantics
    });
  });

  it('is deterministic for fixed inputs and secret-sensitive', async () => {
    const a = await mintJwt({ app_role: 'commish', app_slot: null }, 's1', 1_700_000_000);
    const b = await mintJwt({ app_role: 'commish', app_slot: null }, 's1', 1_700_000_000);
    const c = await mintJwt({ app_role: 'commish', app_slot: null }, 's2', 1_700_000_000);
    expect(a).toBe(b);
    expect(a.split('.')[2]).not.toBe(c.split('.')[2]);
  });

  it('hashes PINs as sha256(salt || pin)', async () => {
    // independently derived: echo -n "saltX1234" | shasum -a 256
    expect(await sha256Hex('saltX1234')).toBe(
      'a8a712ff69ad7bc596ed3becaed415046ad62265113b08194852d2606aa81ca4',
    );
  });
});

describe('verifyJwt', () => {
  it('accepts its own tokens, rejects bad signatures and expiry', async () => {
    const { mintJwt, verifyJwt } = await import('../../../supabase/functions/auth-pin/jwt.ts');
    const t = await mintJwt({ app_role: 'team', app_slot: 4 }, 'sek', 1_700_000_000);
    expect(await verifyJwt(t, 'sek', 1_700_000_100)).toMatchObject({ app_role: 'team', app_slot: 4 });
    expect(await verifyJwt(t, 'wrong', 1_700_000_100)).toBeNull();
    expect(await verifyJwt(t, 'sek', 1_700_090_000)).toBeNull(); // past exp
    expect(await verifyJwt('garbage', 'sek')).toBeNull();
  });
});
