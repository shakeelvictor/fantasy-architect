// Pure crypto helpers for the auth-pin edge function. Web Crypto only, so
// the same module runs under Deno (production) and Node/vitest (tests).

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AppClaims {
  app_role: 'commish' | 'team';
  app_slot: number | null;
}

// HS256 JWT with Supabase-compatible shape: `role: authenticated` is the
// Postgres role PostgREST assumes; our authorization claims are app_role /
// app_slot, read by fa_role() / fa_slot() in the database. exp is absolute
// (24h, like v1's gate) — re-enter the PIN, get a fresh day.
export async function mintJwt(
  claims: AppClaims,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = 24 * 60 * 60,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'fa2-auth-pin',
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    ...claims,
  };
  const signingInput =
    b64url(enc.encode(JSON.stringify(header))) + '.' + b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signingInput)));
  return signingInput + '.' + b64url(sig);
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64)) as Record<string, unknown>;
}
