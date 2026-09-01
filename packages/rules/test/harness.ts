// PGlite test harness: real Postgres (WASM) running the real migration, with
// the two things Supabase's platform normally provides shimmed in —
// auth.jwt() (reads the request.jwt.claims GUC, same as production) and the
// anon/authenticated roles with Supabase-ish default grants. RLS is enforced
// by SET ROLE: PGlite's superuser bypasses RLS, so every client call in
// tests runs as the non-superuser `authenticated` (or `anon`) role, exactly
// as PostgREST would execute it.

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase');

export interface Claims {
  app_role: 'commish' | 'team';
  app_slot?: number;
}

export interface SubmitResult {
  status?: string;
  seq?: number;
  derived?: number;
  error?: string;
}

export async function createDb(): Promise<Harness> {
  const db = new PGlite();
  await db.exec(readFileSync(join(SUPABASE, 'dev', 'shim.sql'), 'utf8'));
  await db.exec(readFileSync(join(SUPABASE, 'migrations', '0001_foundation.sql'), 'utf8'));
  await db.exec(readFileSync(join(SUPABASE, 'dev', 'grants.sql'), 'utf8'));
  return new Harness(db);
}

export class Harness {
  constructor(readonly db: PGlite) {}

  async seedSeason(year: number, config: object): Promise<void> {
    await this.db.query(`insert into seasons (year, config) values ($1, $2)`, [
      year,
      JSON.stringify(config),
    ]);
  }

  private async become(claims: Claims | 'anon'): Promise<void> {
    if (claims === 'anon') {
      await this.db.exec(`set role anon; select set_config('request.jwt.claims', '', false);`);
    } else {
      await this.db.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ role: 'authenticated', ...claims }),
      ]);
      await this.db.exec(`set role authenticated;`);
    }
  }

  private async restore(): Promise<void> {
    await this.db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }

  /** Drive the RPC as a given identity. Errors come back as {error} for assertion. */
  async submit(
    claims: Claims,
    season: number,
    key: string,
    type: string,
    payload: object = {},
  ): Promise<SubmitResult> {
    await this.become(claims);
    try {
      const r = await this.db.query<{ submit_event: SubmitResult }>(
        `select submit_event($1, $2, $3, $4)`,
        [season, key, type, JSON.stringify(payload)],
      );
      return r.rows[0]!.submit_event;
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      await this.restore();
    }
  }

  /** Raw INSERT as a client role — for proving the trigger guards direct writes too. */
  async rawInsert(
    claims: Claims | 'anon',
    season: number,
    key: string,
    type: string,
    payload: object,
  ): Promise<{ error?: string }> {
    await this.become(claims);
    try {
      const actor = claims === 'anon' ? {} : { role: claims.app_role, slot: claims.app_slot };
      await this.db.query(
        `insert into draft_events (season, type, actor, payload, idempotency_key)
         values ($1, $2, $3, $4, $5)`,
        [season, type, JSON.stringify(actor), JSON.stringify(payload), key],
      );
      return {};
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      await this.restore();
    }
  }

  async foldState(season: number): Promise<Record<string, unknown>> {
    const r = await this.db.query<{ fold_state: Record<string, unknown> }>(
      `select fold_state($1)`,
      [season],
    );
    return r.rows[0]!.fold_state;
  }

  async events(season: number): Promise<{ seq: number; type: string; payload: Record<string, unknown> }[]> {
    const r = await this.db.query<{ seq: number | bigint; type: string; payload: Record<string, unknown> }>(
      `select seq, type, payload from draft_events where season = $1 order by seq`,
      [season],
    );
    return r.rows.map((row) => ({ ...row, seq: Number(row.seq) }));
  }

  async eventCount(season: number): Promise<number> {
    const r = await this.db.query<{ n: number | bigint }>(
      `select count(*) as n from draft_events where season = $1`,
      [season],
    );
    return Number(r.rows[0]!.n);
  }

  /** Read events as a spectator with no token at all. */
  async anonReadCount(season: number): Promise<number | { error: string }> {
    await this.become('anon');
    try {
      const r = await this.db.query<{ n: number | bigint }>(
        `select count(*) as n from draft_events where season = $1`,
        [season],
      );
      return Number(r.rows[0]!.n);
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      await this.restore();
    }
  }
}
