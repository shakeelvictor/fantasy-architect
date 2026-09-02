// A team drafting for itself, with the commissioner signed out.
//
// This is the scenario that motivated the change: the commissioner used to
// have to convert every single request into a pick, which made them a
// bottleneck on the whole night — step away, sign out, or just miss the
// banner, and the board stopped for everyone.

import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:8787/reset?season=2027');
});

async function open(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('conn')).toContainText('live');
}

test('a team drafts on its own turn with no commissioner present', async ({ browser }) => {
  const commishCtx = await browser.newContext();
  const anandCtx = await browser.newContext();   // slot 1, picks first
  const vipCtx = await browser.newContext();     // slot 2, picks second
  const commish = await commishCtx.newPage();
  const anand = await anandCtx.newPage();
  const vip = await vipCtx.newPage();
  for (const p of [commish, anand, vip]) await p.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());

  await open(commish, '1111');
  await open(anand, '2201');
  await open(vip, '2202');
  await commish.getByTestId('start-draft').click();
  await expect(anand.getByTestId('onclock')).toContainText('Anand');

  // the commissioner leaves the room entirely
  commish.once('dialog', (d) => void d.accept());
  await commish.getByTestId('sign-out').click();
  await expect(commish.getByTestId('pin-input')).toBeVisible();

  // ---- Anand is on the clock and drafts, unaided
  const row = anand.locator('[data-testid^="row-"]').first();
  const first = (await row.locator('.p-name').innerText()).split('\n')[0]!.trim();
  await row.locator('[data-testid^="draft-"]').click();
  await anand.getByTestId('dconf-ok').click();

  // it lands on the real board, and Vip sees it without a refresh
  await expect(anand.getByTestId('cell-1')).toContainText(first.split(/\s/)[0]!);
  await expect(vip.getByTestId('cell-1')).toContainText(first.split(/\s/)[0]!);
  await expect(vip.getByTestId('onclock')).toContainText('Vip');

  // ---- and the clock moves on: Vip drafts next, also unaided
  const vRow = vip.locator('[data-testid^="row-"]').first();
  const second = (await vRow.locator('.p-name').innerText()).split('\n')[0]!.trim();
  await vRow.locator('[data-testid^="draft-"]').click();
  await vip.getByTestId('dconf-ok').click();
  await expect(vip.getByTestId('cell-2')).toContainText(second.split(/\s/)[0]!);
  await expect(anand.getByTestId('cell-2')).toContainText(second.split(/\s/)[0]!);

  await commishCtx.close();
  await anandCtx.close();
  await vipCtx.close();
});

test('off the clock, a team can only ask', async ({ browser }) => {
  const commishCtx = await browser.newContext();
  const vipCtx = await browser.newContext();
  const commish = await commishCtx.newPage();
  const vip = await vipCtx.newPage();
  for (const p of [commish, vip]) await p.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await open(commish, '1111');
  await open(vip, '2202');
  await commish.getByTestId('start-draft').click();

  // slot 1 is up, so Vip (slot 2) gets Ask, not Draft — the DB would refuse a
  // pick anyway, and the button should not offer what the server will reject
  await expect(vip.getByTestId('onclock')).toContainText('Anand');
  const row = vip.locator('[data-testid^="row-"]').first();
  const pid = await row.getAttribute('data-pid');
  await expect(vip.locator(`[data-testid="ask-${pid}"]`)).toBeVisible();
  await expect(vip.locator(`[data-testid="draft-${pid}"]`)).toHaveCount(0);

  // and the ask still reaches the commissioner as a request
  await vip.locator(`[data-testid="ask-${pid}"]`).click();
  await expect(commish.getByTestId('req-banner')).toContainText('Vip');

  await commishCtx.close();
  await vipCtx.close();
});
