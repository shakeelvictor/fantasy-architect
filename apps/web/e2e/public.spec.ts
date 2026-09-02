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

  // ---- v1's hot take: a grade card opens the analysis behind it
  await page.getByTestId('grade-2').click();
  const take = page.getByTestId('team-take');
  await expect(take).toBeVisible();
  await expect(take.locator('#team-modal-name')).toHaveText('Vip');
  await expect(take.locator('.grade-letter.big')).toHaveText('A');
  await expect(take.getByTestId('team-take-facts')).toContainText('20 picks');
  // seasoned with facts from the real picks, not generic filler
  await expect(take.getByTestId('team-take-blurb')).toContainText(/Vip/);

  // The modal must cover the VIEWPORT. It renders inside .card, which carries
  // a transform, and a transform makes a fixed descendant resolve against
  // that box instead — which put this 3600px down the page until it was
  // portalled to body. A rect starting at 0,0 is the proof.
  const box = await take.boundingBox();
  expect(box!.x).toBe(0);
  expect(box!.y).toBe(0);
  expect(box!.height).toBeGreaterThan(300);

  await take.getByRole('button', { name: 'Close' }).click();
  await expect(take).toHaveCount(0);

  await ctx.close();
});

test('teams sharing a grade get different takes', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await page.goto('/2026');

  // The rotation is the whole reason this is not Math.random(): teams in the
  // same grade band draw from a shared pool at different offsets. Five of the
  // 2026 teams graded C, and five identical paragraphs would be the failure.
  //
  // Compare the SHAPE, with each team's own name stripped out. Comparing the
  // rendered sentences instead proves nothing — every line interpolates the
  // team name, so five teams yield five distinct strings even when they all
  // drew the same template, which is precisely the bug being guarded against.
  const shapes = new Set<string>();
  for (const slot of [1, 3, 4, 6, 7]) { // the C-graded teams
    await page.getByTestId(`grade-${slot}`).click();
    const take = page.getByTestId('team-take');
    await expect(take.locator('.grade-letter.big')).toHaveText('C');
    const name = await take.locator('#team-modal-name').innerText();
    const opener = (await take.getByTestId('team-take-blurb').innerText()).split('. ')[0]!;
    shapes.add(opener.split(name).join('«team»'));
    await take.getByRole('button', { name: 'Close' }).click();
  }
  expect(shapes.size).toBe(5);

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

test('2025 renders, and refuses to invent grades it does not have', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await page.goto('/2025');

  // the board and rosters are exact — 11 x 20, straight
  await expect(page.locator('.board-cell')).toHaveCount(220);
  await expect(page.getByTestId('year-2025')).toHaveClass(/active/);
  await expect(page.getByTestId('year-2026')).toBeVisible(); // both years listed

  // the keeper question, which is the reason this page exists
  await page.getByTestId('public-search').fill('Puka Nacua');
  await expect(page.getByTestId('public-results')).toContainText('11.11');
  await expect(page.getByTestId('public-results')).toContainText('keeper');

  // This draft was imported from a spreadsheet, so the projections behind the
  // grades are gone. Grading it anyway would give every team identical value
  // and print eleven identical Cs — an assessment-shaped thing that is not
  // one. The page says so instead.
  await expect(page.getByTestId('no-grades')).toContainText('reconstructed from a spreadsheet');
  await expect(page.locator('[data-testid^="grade-"]')).toHaveCount(0);
  await expect(page.getByTestId('retro-grid')).toHaveCount(0);
  await expect(page.getByTestId('retro-pending')).toHaveCount(0);

  await ctx.close();
});
