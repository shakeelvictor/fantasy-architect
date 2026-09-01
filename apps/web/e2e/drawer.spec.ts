// The player card/drawer, ported from v1: a pool row click opens the card,
// the hero shows the league-scoring ranks, the Depth tab renders whole from
// the bake with no network, the queue button round-trips, and the card's
// Draft button records a real pick. Sleeper's remote endpoints are blocked
// here — the card must degrade gracefully offline (v1's lesson: never let a
// fetch decide whether the draft tool works).

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

test('player card: open, tabs, queue, draft from the card', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // the card must not depend on Sleeper being reachable
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(page, '1111'); // commissioner

  // ---- a pool row click opens the card on that player
  const topRow = page.locator('[data-testid^="row-"]').first();
  const name = (await topRow.locator('.p-name').innerText()).split('\n')[0]!.trim();
  await topRow.click();
  const drawer = page.getByTestId('player-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.drawer-hero h2')).toContainText(name.split(/\s/)[0]!);
  // league-scoring ranks row renders from the bake
  await expect(drawer.locator('.pc-ranks .pc-rank').first()).toContainText('#1');
  // offline outlook degrades to the no-outlook line, not a spinner forever
  await expect(drawer.locator('#outlook-slot')).toContainText(/outlook/i);

  // ---- Game Log tab: the projection strip renders without any fetch
  await page.getByTestId('drawer-tab-log').click();
  await expect(drawer.locator('.wk-bars .wk-bar')).toHaveCount(18);
  await expect(drawer.locator('#drawer-tab-body')).toContainText("Couldn't load");

  // ---- Depth tab is pure bake data — rungs, his row highlighted
  await page.getByTestId('drawer-tab-depth').click();
  await expect(drawer.locator('.depth-chart')).toBeVisible();
  await expect(drawer.locator('.dc-row.is-him')).toHaveCount(1);

  // ---- queue round-trip from the card
  await page.getByTestId('drawer-queue').click();
  await expect(page.getByTestId('drawer-queue')).toContainText('In your queue');
  await page.getByTestId('drawer-queue').click();
  await expect(page.getByTestId('drawer-queue')).toContainText('Add to my queue');

  // ---- Esc closes; board cell click reopens after the draft starts
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await page.getByTestId('start-draft').click();

  // ---- the card's Draft button records a real pick
  await topRow.click();
  await expect(drawer.getByTestId('drawer-draft')).toContainText(name.split(/\s/)[0]!);
  await drawer.getByTestId('drawer-draft').click();
  await expect(drawer).toHaveCount(0); // drafting closes the card
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('cell-1')).toContainText(name.split(/\s/)[0]!);

  // ---- a board cell click opens the card, now showing the drafted banner
  await page.getByTestId('cell-1').click();
  await expect(drawer.getByTestId('drawer-drafted')).toContainText('Drafted by');
  await page.getByTestId('drawer-close').click();
  await expect(drawer).toHaveCount(0);

  await ctx.close();
});
