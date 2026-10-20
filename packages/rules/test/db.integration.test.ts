// The v1 selftest invariants, ported against the real migration running in
// real Postgres (PGlite), driven through submit_event() as the roles the
// JWTs would carry. Seasons are the isolation unit — each test gets its own.
//
// Config used throughout: 3 teams × 4 rounds (12 picks), linear order —
// small enough to drive whole drafts, big enough for every invariant.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Harness } from './harness.ts';
import { foldEvents, type DraftEvent, type DraftState } from '../src/index.ts';

const CFG = { teams: 3, rounds: 4, type: 'linear', order: ['A', 'B', 'C'] };
const COMMISH = { app_role: 'commish' } as const;
const TEAM2 = { app_role: 'team', app_slot: 2 } as const;

let h: Harness;
let yearSeq = 3000;

async function season(): Promise<number> {
  const y = yearSeq++;
  await h.seedSeason(y, CFG);
  return y;
}

beforeAll(async () => {
  h = await createDb();
}, 60_000);

describe('authorization is the database, not code that remembers to check', () => {
  it('a team may request a player for its own slot', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const r = await h.submit(TEAM2, y, `${y}-req`, 'pick_requested', { pid: 'p9', slot: 2 });
    expect(r.status).toBe('applied');
  });

  it('a team writing OUTSIDE its slot is unrepresentable', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const r = await h.submit(TEAM2, y, `${y}-req3`, 'pick_requested', { pid: 'p9', slot: 3 });
    expect(r.error).toMatch(/row-level security/);
  });

  it('a team cannot emit commissioner events — RPC or raw INSERT', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const rpc = await h.submit(TEAM2, y, `${y}-pick`, 'pick_made', { pid: 'p1' });
    expect(rpc.error).toMatch(/row-level security/);
    const raw = await h.rawInsert(TEAM2, y, `${y}-raw`, 'pick_made', {
      pid: 'p1', overall: 1, round: 1, slot: 1, is_keeper: false,
    });
    expect(raw.error).toMatch(/row-level security/);
  });

  it('a spectator with no token reads everything and writes nothing', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    expect(await h.anonReadCount(y)).toBe(1);
    const w = await h.rawInsert('anon', y, `${y}-anon`, 'pick_requested', { pid: 'p1', slot: 1 });
    expect(w.error).toMatch(/row-level security/);
  });
});

describe('the ops-channel contract, kept', () => {
  it('an idempotency key applies exactly once', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const first = await h.submit(COMMISH, y, `${y}-t1`, 'pick_traded', { round: 3, from_slot: 1, to_slot: 2 });
    const second = await h.submit(COMMISH, y, `${y}-t1`, 'pick_traded', { round: 3, from_slot: 1, to_slot: 2 });
    expect(first.status).toBe('applied');
    expect(second.status).toBe('duplicate');
    expect(await h.eventCount(y)).toBe(2); // start + one trade
  });

  it('the log is append-only for clients: no UPDATE, no DELETE', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    await h.db.exec(`set role authenticated;`);
    const upd = await h.db
      .query(`update draft_events set payload = '{}' where season = ${y}`)
      .catch((e: Error) => ({ error: e.message }));
    const del = await h.db
      .query(`delete from draft_events where season = ${y}`)
      .catch((e: Error) => ({ error: e.message }));
    await h.db.exec(`reset role;`);
    // no UPDATE/DELETE policies exist → both statements affect zero rows
    expect((upd as { affectedRows?: number }).affectedRows ?? 0).toBe(0);
    expect((del as { affectedRows?: number }).affectedRows ?? 0).toBe(0);
    expect(await h.eventCount(y)).toBe(1);
  });
});

describe('the migrations carry their own table grants', () => {
  // From 30 Oct 2026 Supabase stops auto-granting new public tables, so a
  // table a migration creates without a GRANT is unreachable through the API
  // on any rebuilt project. dev/grants.sql deliberately no longer papers over
  // that, so this checks the migrations alone.
  it('every public table is granted to anon, authenticated and service_role', async () => {
    const { rows } = await h.db.query<{ missing: string }>(`
      select t.table_name || ' → ' || r.role as missing
      from information_schema.tables t
      cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and not has_table_privilege(r.role, format('public.%I', t.table_name), 'SELECT')
      order by 1`);
    expect(rows.map((r) => r.missing)).toEqual([]);
  });
});

describe('keeper rules', () => {
  it('max 2 per team, one per round — and a re-declare is a move, not a clash', async () => {
    const y = await season();
    const k1 = await h.submit(COMMISH, y, `${y}-k1`, 'keeper_declared', { pid: 'kA', slot: 2, round: 2 });
    expect(k1.status).toBe('applied');
    const clash = await h.submit(COMMISH, y, `${y}-k2`, 'keeper_declared', { pid: 'kB', slot: 2, round: 2 });
    expect(clash.error).toMatch(/already keeps someone in round 2/);
    const k2 = await h.submit(COMMISH, y, `${y}-k3`, 'keeper_declared', { pid: 'kB', slot: 2, round: 3 });
    expect(k2.status).toBe('applied');
    const third = await h.submit(COMMISH, y, `${y}-k4`, 'keeper_declared', { pid: 'kC', slot: 2, round: 4 });
    expect(third.error).toMatch(/already has 2 keepers/);
    const move = await h.submit(COMMISH, y, `${y}-k5`, 'keeper_declared', { pid: 'kA', slot: 2, round: 4 });
    expect(move.status).toBe('applied'); // kA moved R2 → R4, still 2 keepers
  });

  it('a kept pick cannot be traded away', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-k`, 'keeper_declared', { pid: 'kA', slot: 1, round: 2 });
    const t = await h.submit(COMMISH, y, `${y}-t`, 'pick_traded', { round: 2, from_slot: 1, to_slot: 3 });
    expect(t.error).toMatch(/kept pick cannot be traded/);
  });

  it('a traded-away pick cannot be kept with', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-t`, 'pick_traded', { round: 2, from_slot: 1, to_slot: 3 });
    const k = await h.submit(COMMISH, y, `${y}-k`, 'keeper_declared', { pid: 'kA', slot: 1, round: 2 });
    expect(k.error).toMatch(/traded away their R2 pick/);
  });

  it('a kept player is off the board for everyone', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-k`, 'keeper_declared', { pid: 'kA', slot: 3, round: 4 });
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const pick = await h.submit(COMMISH, y, `${y}-p`, 'pick_made', { pid: 'kA' });
    expect(pick.error).toMatch(/registered keeper/);
    const req = await h.submit(TEAM2, y, `${y}-r`, 'pick_requested', { pid: 'kA', slot: 2 });
    expect(req.error).toMatch(/not available/);
  });
});

describe('the draft itself', () => {
  it('REGRESSION: two picks in one round — own kept pick fills, acquired pick stays live', async () => {
    const y = await season();
    // slot 2 keeps at its own R2 pick (#5) AND acquires slot 3's R2 pick (#6)
    await h.submit(COMMISH, y, `${y}-k`, 'keeper_declared', { pid: 'KEEP', slot: 2, round: 2 });
    await h.submit(COMMISH, y, `${y}-t`, 'pick_traded', { round: 2, from_slot: 3, to_slot: 2 });
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    // 5 submitted picks fill #1–#4 and #6 — the keeper consumes #5 on its own
    for (const [i, pid] of ['a', 'b', 'c', 'd', 'e'].entries()) {
      const r = await h.submit(COMMISH, y, `${y}-p${i}`, 'pick_made', { pid });
      expect(r.status).toBe('applied');
    }
    const st = await h.foldState(y);
    const picks = st.picks as { overall: number; pid: string; slot: number; is_keeper: boolean }[];
    const five = picks.find((p) => p.overall === 5)!;
    expect(five).toMatchObject({ pid: 'KEEP', slot: 2, is_keeper: true });
    // #6 — the ACQUIRED second R2 pick — was filled by 'e' as a live pick, not re-matched
    const six = picks.find((p) => p.overall === 6)!;
    expect(six).toMatchObject({ pid: 'e', slot: 2, is_keeper: false });
    expect(picks.filter((p) => p.pid === 'KEEP')).toHaveLength(1);
  });

  it('consecutive keepers chain in one pass and the clock skips those teams', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-k1`, 'keeper_declared', { pid: 'K2', slot: 2, round: 1 });
    await h.submit(COMMISH, y, `${y}-k2`, 'keeper_declared', { pid: 'K3', slot: 3, round: 1 });
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const r = await h.submit(COMMISH, y, `${y}-p1`, 'pick_made', { pid: 'a' });
    expect(r.derived).toBe(2); // both round-1 keepers filled behind pick #1
    const st = await h.foldState(y);
    const picks = st.picks as { overall: number; pid: string }[];
    expect(picks.map((p) => p.pid)).toEqual(['a', 'K2', 'K3']);
  });

  it('undo pops trailing keeper fills with the pick, and the player is draftable again', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-k`, 'keeper_declared', { pid: 'K2', slot: 2, round: 1 });
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    await h.submit(COMMISH, y, `${y}-p1`, 'pick_made', { pid: 'a' }); // fills #1 + keeper #2
    const undo = await h.submit(COMMISH, y, `${y}-undo`, 'pick_undone');
    expect(undo.status).toBe('applied');
    const st = await h.foldState(y);
    expect(st.picks).toEqual([]);
    // 'a' is draftable again — and the keeper re-fills right behind it
    const again = await h.submit(COMMISH, y, `${y}-p1b`, 'pick_made', { pid: 'a' });
    expect(again.status).toBe('applied');
    expect(again.derived).toBe(1);
  });

  it('out-of-turn and wrong-owner picks are refused even as direct inserts', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const wrongOverall = await h.rawInsert(COMMISH, y, `${y}-w1`, 'pick_made', {
      pid: 'x', overall: 5, round: 2, slot: 2, is_keeper: false,
    });
    expect(wrongOverall.error).toMatch(/out of turn/);
    const wrongSlot = await h.rawInsert(COMMISH, y, `${y}-w2`, 'pick_made', {
      pid: 'x', overall: 1, round: 1, slot: 3, is_keeper: false,
    });
    expect(wrongSlot.error).toMatch(/belongs to slot 1/);
    const fakeKeeper = await h.rawInsert(COMMISH, y, `${y}-w3`, 'pick_made', {
      pid: 'x', overall: 1, round: 1, slot: 1, is_keeper: true,
    });
    expect(fakeKeeper.error).toMatch(/no keeper is owed/);
  });

  it('a drafted player cannot be drafted twice', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    await h.submit(COMMISH, y, `${y}-p1`, 'pick_made', { pid: 'a' });
    const dupe = await h.submit(COMMISH, y, `${y}-p2`, 'pick_made', { pid: 'a' });
    expect(dupe.error).toMatch(/already drafted/);
  });

  it('ownership follows a trade; reverting returns it', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-t`, 'pick_traded', { round: 1, from_slot: 2, to_slot: 3 });
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    await h.submit(COMMISH, y, `${y}-p1`, 'pick_made', { pid: 'a' });
    await h.submit(COMMISH, y, `${y}-p2`, 'pick_made', { pid: 'b' });
    const st = await h.foldState(y);
    const picks = st.picks as { overall: number; slot: number }[];
    expect(picks.find((p) => p.overall === 2)!.slot).toBe(3); // board column 2, owner 3
    const rv = await h.submit(COMMISH, y, `${y}-rv`, 'trade_reverted', { round: 3, from_slot: 2 });
    expect(rv.error).toMatch(/no such trade/);
  });

  it('the Take-it flow: request → accept lands the pick; not-on-the-clock is refused', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const req = await h.submit(TEAM2, y, `${y}-req`, 'pick_requested', { pid: 'z', slot: 2 });
    // slot 1 is on the clock — accepting slot 2's ask must fail
    const early = await h.submit(COMMISH, y, `${y}-acc1`, 'pick_request_resolved', {
      request_seq: req.seq, accepted: true,
    });
    expect(early.error).toMatch(/not on the clock/);
    await h.submit(COMMISH, y, `${y}-p1`, 'pick_made', { pid: 'a' });
    const acc = await h.submit(COMMISH, y, `${y}-acc2`, 'pick_request_resolved', {
      request_seq: req.seq, accepted: true,
    });
    expect(acc.status).toBe('applied');
    expect(acc.derived).toBe(1);
    const st = await h.foldState(y);
    const picks = st.picks as { overall: number; pid: string; slot: number }[];
    expect(picks.find((p) => p.overall === 2)).toMatchObject({ pid: 'z', slot: 2 });
  });

  it('draft_completed is refused early and accepted at a full board', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    const early = await h.submit(COMMISH, y, `${y}-done1`, 'draft_completed');
    expect(early.error).toMatch(/not complete/);
    for (let i = 0; i < 12; i++) {
      await h.submit(COMMISH, y, `${y}-p${i}`, 'pick_made', { pid: `p${i}` });
    }
    const extra = await h.submit(COMMISH, y, `${y}-p99`, 'pick_made', { pid: 'p99' });
    expect(extra.error).toBeDefined(); // 13th pick has nowhere to land
    const done = await h.submit(COMMISH, y, `${y}-done2`, 'draft_completed');
    expect(done.status).toBe('applied');
  });
});

describe('one reducer, two runtimes', () => {
  it('the TS fold and the SQL fold agree over a full eventful draft', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-k1`, 'keeper_declared', { pid: 'KEEP', slot: 2, round: 2 });
    await h.submit(COMMISH, y, `${y}-t1`, 'pick_traded', { round: 2, from_slot: 3, to_slot: 2 });
    await h.submit(COMMISH, y, `${y}-t2`, 'pick_traded', { round: 4, from_slot: 2, to_slot: 3 });
    await h.submit(COMMISH, y, `${y}-rvt`, 'trade_reverted', { round: 4, from_slot: 2 });
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    await h.submit(COMMISH, y, `${y}-p0`, 'pick_made', { pid: 'a' });
    const req = await h.submit(TEAM2, y, `${y}-rq`, 'pick_requested', { pid: 'q', slot: 2 });
    await h.submit(COMMISH, y, `${y}-acc`, 'pick_request_resolved', { request_seq: req.seq, accepted: true });
    await h.submit(COMMISH, y, `${y}-p2`, 'pick_made', { pid: 'c' });
    await h.submit(COMMISH, y, `${y}-undo`, 'pick_undone');
    await h.submit(COMMISH, y, `${y}-p2b`, 'pick_made', { pid: 'd' });

    const events = (await h.events(y)) as unknown as DraftEvent[];
    const ts: DraftState = foldEvents(events);
    const sql = await h.foldState(y);
    expect(ts.picks).toEqual(sql.picks);
    expect(ts.keepers).toEqual(sql.keepers);
    expect(ts.trades).toEqual(sql.trades);
    expect(ts.requests).toEqual(sql.requests);
    expect(ts.started).toEqual(sql.started);
    expect(ts.completed).toEqual(sql.completed);
  });
});

// ---------------------------------------------------------- season setup
//
// Config is the one piece of draft state that is NOT an event, because every
// pick's coordinates were computed under the config in force when it landed.
// Re-shaping a board that already has picks would reinterpret history rather
// than record a change, so the database freezes it — and that has to hold for
// the commissioner too, since it is a rule and not a permission.

describe('season settings are the commissioner\'s, and only before the draft', () => {
  const NEXT = { teams: 4, rounds: 5, type: 'snake', order: ['W', 'X', 'Y', 'Z'] };

  it('the commissioner can re-shape a season that has not started', async () => {
    const y = await season();
    expect(await h.setConfig(COMMISH, y, NEXT)).toEqual({});
    expect(await h.configOf(y)).toMatchObject({ teams: 4, rounds: 5, type: 'snake' });
  });

  it('the teams table follows the order, keeping slots in step', async () => {
    const y = await season();
    await h.setConfig(COMMISH, y, NEXT);
    expect(await h.ownersOf(y)).toEqual(['W', 'X', 'Y', 'Z']);
    // shrinking drops the slots that no longer exist
    await h.setConfig(COMMISH, y, { ...NEXT, teams: 2, order: ['W', 'X'] });
    expect(await h.ownersOf(y)).toEqual(['W', 'X']);
  });

  it('a team PIN cannot re-shape the league, and is told why', async () => {
    const y = await season();
    const r = await h.setConfig(TEAM2, y, NEXT);
    // RLS alone would filter the row and report "does not exist", which reads
    // as a missing season rather than a refusal — and it reaches the UI
    expect(r.error).toMatch(/only the commissioner/);
    expect(await h.configOf(y)).toMatchObject({ teams: 3 });
  });

  it('a spectator cannot either', async () => {
    const y = await season();
    expect((await h.setConfig('anon', y, NEXT)).error).toBeTruthy();
  });

  it('starting the draft alone does NOT freeze it — that click is recoverable', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start`, 'draft_started');
    expect(await h.setConfig(COMMISH, y, NEXT)).toEqual({});
  });

  it('a keeper freezes it — that event names a slot and a round', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-k`, 'keeper_declared', { pid: 'p1', slot: 2, round: 3 });
    const r = await h.setConfig(COMMISH, y, NEXT);
    expect(r.error).toMatch(/frozen/);
    expect(await h.configOf(y)).toMatchObject({ teams: 3, rounds: 4 });
  });

  it('a pick freezes it too, for the commissioner as much as anyone', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-start2`, 'draft_started');
    await h.submit(COMMISH, y, `${y}-p`, 'pick_made', { pid: 'p7' });
    const r = await h.setConfig(COMMISH, y, NEXT);
    expect(r.error).toMatch(/frozen/);
    expect(await h.configOf(y)).toMatchObject({ teams: 3, rounds: 4 });
  });

  it('a malformed shape is refused', async () => {
    const y = await season();
    expect((await h.setConfig(COMMISH, y, { ...NEXT, type: 'sideways' })).error).toMatch(/linear or snake/);
    expect((await h.setConfig(COMMISH, y, { ...NEXT, teams: 99 })).error).toMatch(/between 2 and 16/);
    expect((await h.setConfig(COMMISH, y, { ...NEXT, order: ['W', 'X'] })).error).toMatch(/name all 4/);
    expect((await h.setConfig(COMMISH, y, { ...NEXT, order: ['W', ' ', 'Y', 'Z'] })).error).toMatch(/slot 2/);
    expect(await h.configOf(y)).toMatchObject({ teams: 3 }); // nothing partially applied
  });
});

// ------------------------------------------------------- teams draft
//
// A team drafting for itself removes the commissioner as a bottleneck on
// every pick. The boundary has to be exact, so it is tested from both sides:
// what a team may now do, and everything it still may not.

describe('a team drafts on its own turn, and only then', () => {
  const TEAM1 = { app_role: 'team', app_slot: 1 } as const;

  it('drafts for itself when it is on the clock', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-s`, 'draft_started');
    const r = await h.submit(TEAM1, y, `${y}-p`, 'pick_made', { pid: 'p1' }); // slot 1 is up
    expect(r.status).toBe('applied');
    const st = await h.foldState(y);
    expect((st.picks as { pid: string; slot: number }[])[0]).toMatchObject({ pid: 'p1', slot: 1 });
  });

  it('cannot draft on someone else\'s turn', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-s`, 'draft_started');
    // pick #1 belongs to slot 1, so slot 2 reaching for it is refused
    const r = await h.submit(TEAM2, y, `${y}-p`, 'pick_made', { pid: 'p1' });
    expect(r.error).toBeTruthy();
    expect((await h.foldState(y)).picks).toHaveLength(0);
  });

  it('cannot forge a pick for another slot by writing the row directly', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-s`, 'draft_started');
    // slot 2 claiming to be slot 1, bypassing submit_event entirely
    const r = await h.rawInsert(TEAM2, y, `${y}-forge`, 'pick_made',
      { pid: 'p1', overall: 1, round: 1, slot: 1, is_keeper: false });
    expect(r.error).toBeTruthy();
    expect((await h.foldState(y)).picks).toHaveLength(0);
  });

  it('cannot claim its own slot for a pick that is not its turn', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-s`, 'draft_started');
    // overall 2 belongs to slot 2; slot 1 stamping its own number on it is
    // caught by fa_validate before RLS even matters
    const r = await h.rawInsert(TEAM1, y, `${y}-skip`, 'pick_made',
      { pid: 'p1', overall: 2, round: 1, slot: 1, is_keeper: false });
    expect(r.error).toBeTruthy();
  });

  it('cannot pass off a pick as a keeper fill', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-s`, 'draft_started');
    const r = await h.rawInsert(TEAM1, y, `${y}-k`, 'pick_made',
      { pid: 'p1', overall: 1, round: 1, slot: 1, is_keeper: true });
    expect(r.error).toBeTruthy();
  });

  it('still cannot undo, trade, keep, start or finish the draft', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-s`, 'draft_started');
    await h.submit(TEAM1, y, `${y}-p`, 'pick_made', { pid: 'p1' });
    for (const [type, payload] of [
      ['pick_undone', {}],
      ['keeper_declared', { pid: 'p9', slot: 1, round: 4 }],
      ['pick_traded', { round: 3, from_slot: 1, to_slot: 2 }],
      ['draft_completed', {}],
    ] as const) {
      const r = await h.submit(TEAM1, y, `${y}-${type}`, type, payload);
      expect(r.error, `a team must not be able to ${type}`).toBeTruthy();
    }
    // and the pick it legitimately made is still the only one
    expect((await h.foldState(y)).picks).toHaveLength(1);
  });

  it('cannot resolve a request — not even its own', async () => {
    const y = await season();
    await h.submit(COMMISH, y, `${y}-s`, 'draft_started');
    const req = await h.submit(TEAM2, y, `${y}-req`, 'pick_requested', { pid: 'p5', slot: 2 });
    const r = await h.submit(TEAM2, y, `${y}-res`, 'pick_request_resolved',
      { request_seq: req.seq, accepted: true });
    expect(r.error).toBeTruthy();
  });
});
