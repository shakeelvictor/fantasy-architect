// keep_warm() — the write that keep-warm.yml makes so Supabase sees a project
// in use. It must actually change a row (a read was not enough), and anon must
// reach the table ONLY through it.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Harness } from './harness.ts';

let h: Harness;

beforeAll(async () => {
  h = await createDb();
}, 60_000);

async function asAnon<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  await h.db.exec(`set role anon; select set_config('request.jwt.claims', '', false);`);
  try {
    return await fn();
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    await h.db.exec(`reset role;`);
  }
}

async function beats(): Promise<number> {
  const r = await h.db.query<{ beats: string }>(`select beats from heartbeat`);
  return r.rows.length ? Number(r.rows[0]!.beats) : 0;
}

describe('keep_warm', () => {
  it('anon can call it, and every call is a write', async () => {
    const before = await beats();
    const r1 = await asAnon(() => h.db.query(`select keep_warm()`));
    const r2 = await asAnon(() => h.db.query(`select keep_warm()`));
    expect(r1).not.toHaveProperty('error');
    expect(r2).not.toHaveProperty('error');
    expect(await beats()).toBe(before + 2);
    const rows = await h.db.query(`select * from heartbeat`);
    expect(rows.rows).toHaveLength(1);
  });

  it('anon cannot touch the table directly', async () => {
    await asAnon(() => h.db.query(`select keep_warm()`));
    const before = await beats();
    await asAnon(() => h.db.query(`update heartbeat set beats = 0`));
    await asAnon(() => h.db.query(`delete from heartbeat`));
    await asAnon(() => h.db.query(`insert into heartbeat (id, beats) values (true, 0)`));
    const seen = await asAnon(() => h.db.query(`select * from heartbeat`));
    expect(await beats()).toBe(before);
    expect((seen as { rows: unknown[] }).rows).toHaveLength(0);
  });
});
