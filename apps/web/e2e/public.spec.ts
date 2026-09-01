// The public per-year draft record: /2026, no PIN.
//
// The gate check is the load-bearing assertion — this page exists so a
// manager can be handed a link instead of credentials, and a regression that
// put it behind the PIN would be silent until someone complained.

import { expect, test } from '@playwright/test';

test('a past draft is readable with no session at all', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());

  await page.goto('/2026');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // never gated
  await expect(page.getByTestId('pin-input')).toHaveCount(0);
  await expect(page.getByTestId('public-banner')).toContainText('read-only');

  // the keeper lookup: a name in, the round it cost out
  await page.getByTestId('public-search').fill('Bowers');
  const hit = page.getByTestId('public-results').locator('.rec-item').first();
  await expect(hit).toContainText('Brock Bowers');
  await expect(hit).toContainText('pick 3.02');
  await expect(hit).toContainText('#24 overall');
  await expect(hit).toContainText('Vip');
  await expect(hit.locator('.rec-pts')).toHaveText('R3');

  // a name nobody drafted says so rather than showing nothing
  await page.getByTestId('public-search').fill('Zzzz');
  await expect(page.getByTestId('public-results')).toContainText('Nobody by that name');

  // the board and the rosters
  await page.getByTestId('public-search').fill('');
  await expect(page.locator('.board-cell').first()).toContainText('Gibbs');
  await expect(page.locator('#analyzer-content, .grade-grid').first()).toBeVisible();

  // the Analyzer's grades, as pinned on draft night
  const grades = page.locator('[data-testid^="grade-"]');
  await expect(grades).toHaveCount(11);
  await expect(page.getByTestId('grade-2')).toContainText('Vip');
  await expect(page.getByTestId('grade-2').locator('.grade-letter')).toHaveText('A');

  // 2026 has not been played, so the retrospective holds off
  await expect(page.getByTestId('retro-pending')).toContainText('has not kicked off');

  await ctx.close();
});

test('a year with no archive says so instead of erroring', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/2031');
  await expect(page.getByTestId('public-missing')).toContainText('No 2031 draft here yet');
  await expect(page.getByTestId('public-missing')).toContainText('Archived so far: 2026');
  await expect(page.getByTestId('pin-input')).toHaveCount(0);
  await ctx.close();
});
