// Mock drafts, the architectural promise made executable: every mock
// mutation folds through the SAME reducer as the real draft, but into a
// LOCAL event list — so after a whole mock session the server's log must
// still be empty, and flipping back to Manual shows the untouched board.

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

test('mock draft: bots pick, pause on your turn, real board untouched', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(page, '1111'); // commissioner, mock slot #11

  // ---- entering mock starts a local draft immediately (bots paused)
  await page.getByTestId('mode-mock').click();
  await expect(page.getByTestId('onclock')).toContainText('On the clock');

  // ---- with bots paused you can pick for any team, v1-style
  const topRow = page.locator('[data-testid^="row-"]').first();
  const firstName = (await topRow.locator('.p-name').innerText()).split(/\s/)[0]!;
  await topRow.locator('[data-testid^="draft-"]').click();
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('cell-1')).toContainText(firstName);
  await page.getByTestId('tab-draft').click();

  // ---- fastest bots, then let them run to your pick (#11) and pause
  await page.getByTestId('mock-speed').fill('3000');
  await page.getByTestId('mock-start').click();
  await expect(page.locator('.next-pick-divider')).toContainText("You're on the clock", { timeout: 20_000 });

  // ---- your pick goes through the same local log; bots resume after
  const mine = page.locator('[data-testid^="row-"]').first();
  const myName = (await mine.locator('.p-name').innerText()).split(/\s/)[0]!;
  await mine.locator('[data-testid^="draft-"]').click();
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('cell-11')).toContainText(myName);
  await expect(page.getByTestId('cell-13').locator('.bc-name')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('tab-draft').click();
  if (await page.getByTestId('mock-pause').isEnabled()) {
    await page.getByTestId('mock-pause').click();
  }

  // ---- the server never heard about any of it
  await page.getByTestId('mode-manual').click();
  await expect(page.getByTestId('onclock')).toContainText('Waiting for the draft to start');
  await expect(page.getByTestId('cell-1').locator('.bc-name')).toHaveCount(0);

  // ---- and the mock survives the round trip (local persistence)
  await page.getByTestId('mode-mock').click();
  await expect(page.getByTestId('cell-1')).toContainText(firstName);

  // ---- mock undo rewinds to just before YOUR pick (v1's mock rule)
  await page.getByTestId('tab-draft').click();
  await page.getByTestId('undo').click();
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('cell-11').locator('.bc-name')).toHaveCount(0);
  await expect(page.getByTestId('cell-10').locator('.bc-name')).toBeVisible();

  // ---- and mock redo puts your pick back, through the same local log
  await page.getByTestId('tab-draft').click();
  await page.getByTestId('redo').click();
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('cell-11')).toContainText(myName);

  await ctx.close();
});
