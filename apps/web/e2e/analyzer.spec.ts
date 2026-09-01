// The Analyzer over an archived draft, and the retrospective that marks those
// grades against what the season actually did.
//
// Actuals are stubbed, for two reasons: the e2e must not depend on Sleeper,
// and the archived 2026 season has not been played yet in real life — the
// not-yet state is asserted against the real (empty) file, then a stubbed
// finished season drives the regrade.
//
// The regrade is season-end only (weeks 1-17 for this league), so a
// half-played season must show progress and NO grades — that boundary is
// asserted directly, since it is the whole point of the design.

import { expect, test, type Page } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  await request.post('http://localhost:8787/reset?season=2027');
});

async function login(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('conn')).toContainText('live');
}

test('past-draft grades and the empty retrospective', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(page, '1111');
  await page.getByTestId('tab-analyzer').click();

  // the live draft is the default source; the archived season sits beside it
  await expect(page.getByTestId('an-src-live')).toHaveClass(/active/);
  await page.getByTestId('an-src-2026').click();

  // grades come from the letters pinned into the archive on draft night
  await expect(page.getByTestId('grade-5')).toContainText('Dante');
  await expect(page.getByTestId('grade-5').locator('.grade-letter')).toHaveText('A');
  await expect(page.getByTestId('grade-9').locator('.grade-letter')).toHaveText('F');
  await expect(page.locator('#analyzer-content')).toContainText('220 picks');

  // 2026 has not kicked off, so there is nothing to mark the grades against
  await expect(page.getByTestId('retro-pending')).toContainText('has not kicked off');
  await expect(page.getByTestId('retro-grid')).toHaveCount(0);

  // the hot take works on the live board too, not just the public page
  await page.getByTestId('an-src-live').click();
  await page.getByTestId('grade-1').click();
  await expect(page.getByTestId('team-take-blurb')).not.toHaveText('');
  await page.getByTestId('team-take').getByRole('button', { name: 'Close' }).click();

  await ctx.close();
});

test('the retrospective marks the grades against real results', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());

  // A season where every player scored a flat 10/game for 17 games EXCEPT
  // Dante's roster, which scored nothing — so the team the board graded an A
  // must come out bottom, and the retrospective must say so.
  const doc = await (await fetch('http://localhost:5173/drafts/2026.json')).json() as {
    teams: { slot: number; roster: { pid: string }[] }[];
  };
  const players: Record<string, [number, number]> = {};
  for (const t of doc.teams) {
    for (const r of t.roster) players[r.pid] = t.slot === 5 ? [0, 0] : [170, 17];
  }
  await page.route('**/actuals/2026.json', (route) =>
    route.fulfill({ json: { season: '2026', throughWeek: 17, seasonWeeks: 17, complete: true, players } }));

  await login(page, '1111');
  await page.getByTestId('tab-analyzer').click();
  await page.getByTestId('an-src-2026').click();

  const retro = page.getByTestId('retro-grid');
  await expect(retro).toBeVisible();
  await expect(page.locator('#analyzer-content')).toContainText('weeks 1–17');

  // Dante was graded A on draft night and scored nothing: overrated, last
  const dante = page.getByTestId('retro-5');
  await expect(dante).toContainText('Dante');
  await expect(dante).toContainText('overrated');
  await expect(dante).toContainText('Draft squad scored: 0');
  // the panel must say WHOSE points these are — read as league standings,
  // "actual grade F" would libel a GM who rescued the season on waivers
  await expect(page.getByTestId('retro-scope')).toContainText('players each team drafted');
  await expect(page.getByTestId('retro-scope')).toContainText('grades the draft, not the season');
  await expect(dante.locator('.grade-letter').first()).toHaveText('A'); // as graded
  await expect(dante.locator('.grade-letter').nth(1)).toHaveText('F');  // as it went

  // everyone else scored identically, so the board's ordering held up
  await expect(page.getByTestId('retro-1')).toContainText('called it');

  await ctx.close();
});

test('a season still being played shows progress, not grades', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  // week 12 of 17: real points on the board, but the season's claim is not in
  await page.route('**/actuals/2026.json', (route) =>
    route.fulfill({ json: {
      season: '2026', throughWeek: 12, seasonWeeks: 17, complete: false,
      players: { '9221': [240, 12] },
    } }));

  await login(page, '1111');
  await page.getByTestId('tab-analyzer').click();
  await page.getByTestId('an-src-2026').click();

  // the draft-night grades still show — those are a record, not a claim about
  // results — but nothing is marked against a half-played season
  await expect(page.getByTestId('grade-5').locator('.grade-letter')).toHaveText('A');
  await expect(page.getByTestId('retro-pending')).toContainText('12 of 17 weeks');
  await expect(page.getByTestId('retro-grid')).toHaveCount(0);

  await ctx.close();
});
