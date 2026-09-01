// Golden-master suite: the TS port must reproduce v1's engine BIT-IDENTICALLY
// over 35k+ real stat lines (full-season projections, weekly projections,
// 2025 actuals), in both scoring modes. `toBe` on raw doubles is deliberate —
// the port keeps the original's operation order, so any difference at all
// means the port drifted. Do not loosen to toBeCloseTo.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreWeek, type StatLine } from '../src/index.ts';

interface GoldenCase {
  pid: string | null;
  s: StatLine;
  ev: number;
  ex: number;
}
interface GoldenFixture {
  source: string;
  engine: string;
  cases: GoldenCase[];
}

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.golden.json')).sort();

it('has the full fixture set', () => {
  expect(files.length).toBe(7);
});

for (const file of files) {
  describe(file, () => {
    const fixture = JSON.parse(readFileSync(join(dir, file), 'utf8')) as GoldenFixture;

    it(`matches v1 exactly on all ${fixture.cases.length} stat lines`, () => {
      let evMismatch = 0;
      let exMismatch = 0;
      let firstBad: string | null = null;
      for (const c of fixture.cases) {
        const ev = scoreWeek(c.s);
        const ex = scoreWeek(c.s, true);
        if (ev !== c.ev) {
          evMismatch++;
          firstBad ??= `pid=${c.pid} ev got ${ev} want ${c.ev} stats=${JSON.stringify(c.s)}`;
        }
        if (ex !== c.ex) {
          exMismatch++;
          firstBad ??= `pid=${c.pid} ex got ${ex} want ${c.ex} stats=${JSON.stringify(c.s)}`;
        }
      }
      expect(evMismatch + exMismatch, firstBad ?? '').toBe(0);
    });
  });
}
