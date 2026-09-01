// Semantic tests, independent of the golden fixtures. The goldens prove the
// port matches v1; these pin the RULES themselves to the published fflr
// scoring, so a future fixture regeneration against a broken engine cannot
// silently bless itself. Values here are hand-derived from
// https://fflr.netlify.app/rules#scoring — not from either engine's output.

import { describe, expect, it } from 'vitest';
import {
  exactTierBonus,
  expectedTierBonus,
  PASS_TIERS,
  RUSH_TIERS,
  REC_TIERS,
  scoreWeek,
  tackleEscalator,
} from '../src/index.ts';

describe('tackle escalator', () => {
  it('pays 1/solo below 7', () => {
    expect(tackleEscalator(0)).toBe(0);
    expect(tackleEscalator(3)).toBe(3);
    expect(tackleEscalator(6.5)).toBe(6.5);
  });
  it('jumps to 7.5 at 7 solos and climbs 0.75 per half-tackle', () => {
    expect(tackleEscalator(7)).toBe(7.5);
    expect(tackleEscalator(8)).toBe(9);
    expect(tackleEscalator(9.5)).toBe(11.25);
  });
  it('jumps to 12.5 at 10 and climbs 1.0 per half-tackle', () => {
    expect(tackleEscalator(10)).toBe(12.5);
    expect(tackleEscalator(12)).toBe(16.5);
  });
});

describe('exact tier bonuses replace, never stack', () => {
  it('passing: 300/325/350 → 1/3/6', () => {
    expect(exactTierBonus(299, PASS_TIERS)).toBe(0);
    expect(exactTierBonus(300, PASS_TIERS)).toBe(1);
    expect(exactTierBonus(349, PASS_TIERS)).toBe(3);
    expect(exactTierBonus(350, PASS_TIERS)).toBe(6);
  });
  it('rushing: 100/125/150 → 1/3/6', () => {
    expect(exactTierBonus(100, RUSH_TIERS)).toBe(1);
    expect(exactTierBonus(150, RUSH_TIERS)).toBe(6);
  });
  it('receiving: 125/150/175 → 1/3/6', () => {
    expect(exactTierBonus(124, REC_TIERS)).toBe(0);
    expect(exactTierBonus(175, REC_TIERS)).toBe(6);
  });
});

describe('expected tier bonus (the thing a naive port breaks)', () => {
  it('is NOT a threshold check: a sub-tier mean still earns expected value', () => {
    // 260 projected pass yards clears 300 in some real weeks, so the
    // expectation is strictly positive — this is the whole reason the
    // engine models a distribution instead of comparing to 300.
    const ev = expectedTierBonus(260, 0.3, PASS_TIERS);
    expect(ev).toBeGreaterThan(0.5);
    expect(ev).toBeLessThan(6);
  });
  it('approaches the top tier as the mean runs away from the bands', () => {
    expect(expectedTierBonus(600, 0.3, PASS_TIERS)).toBeGreaterThan(5.5);
  });
  it('is zero for a zero or negative mean', () => {
    expect(expectedTierBonus(0, 0.3, PASS_TIERS)).toBe(0);
    expect(expectedTierBonus(-5, 0.3, PASS_TIERS)).toBe(0);
  });
});

describe('scoreWeek core rates', () => {
  it('pass TDs are worth 6', () => {
    expect(scoreWeek({ pass_td: 2 }, true)).toBe(12);
  });
  it('rush yards pay 0.13333/yd — 7.5 yds = 1 pt', () => {
    expect(scoreWeek({ rush_yd: 75 }, true)).toBe(10); // below the 100-yd tier, no bonus
  });
  it('half PPR', () => {
    expect(scoreWeek({ rec: 4 }, true)).toBe(2);
  });
  it('kicking is distance-banded, and a 60-yarder is recoverable from finals', () => {
    // finals: fgm_50p=2 of which fgm_50_59=1 → one 60+ kick pays the extra point
    expect(scoreWeek({ fgm_50p: 2, fgm_50_59: 1 }, true)).toBe(11);
    // projections carry no 50/60 split — no remainder applies
    expect(scoreWeek({ fgm_50p: 2 }, false)).toBe(10);
  });
  it('empty and missing stat lines score zero', () => {
    expect(scoreWeek({}, true)).toBe(0);
    expect(scoreWeek(null)).toBe(0);
    expect(scoreWeek(undefined)).toBe(0);
  });
  it('numeric strings are coerced like v1 did', () => {
    expect(scoreWeek({ rec_yd: '100' }, true)).toBe(10);
  });
});
