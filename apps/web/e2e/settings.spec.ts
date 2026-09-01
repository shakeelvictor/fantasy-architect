// Draft Settings: shaping a season from the UI, and the freeze that stops it
// once the draft has a history. The freeze is a database rule (0003's
// trigger); this checks the screen honours it and says why.

import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  // /reset restores the seed config too, so specs cannot reshape each other
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

test('the commissioner can shape the season before it starts', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(page, '1111');

  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await expect(page.getByTestId('set-teams')).toHaveValue('11');
  await expect(page.getByTestId('set-slot-1')).toHaveValue('Anand');

  // rename a slot and shorten the draft
  await page.getByTestId('set-slot-1').fill('Anand B');
  await page.getByTestId('set-rounds').fill('18');
  await page.getByTestId('set-type').selectOption('snake');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-panel')).toHaveCount(0);

  // the change is in the season itself, so the whole app follows it
  await expect(page.locator('#league-sub')).toContainText('18 rounds');
  await expect(page.locator('#league-sub')).toContainText('snake');
  await page.getByTestId('tab-board').click();
  await expect(page.locator('.board-head').first()).toHaveText('Anand B');

  // and it survives a reload — this was written to the database, not a browser
  await page.reload();
  await expect(page.getByTestId('conn')).toContainText('live');
  await expect(page.locator('#league-sub')).toContainText('18 rounds');

  await ctx.close();
});

test('settings freeze once the draft has a log, and teams never see them', async ({ browser }) => {
  const commishCtx = await browser.newContext();
  const teamCtx = await browser.newContext();
  const commish = await commishCtx.newPage();
  const team = await teamCtx.newPage();
  for (const p of [commish, team]) await p.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(commish, '1111');
  await login(team, '2202');

  // a team PIN has no gear at all
  await expect(team.getByTestId('open-settings')).toHaveCount(0);

  // starting the draft binds nothing to the shape, so setup stays open —
  // an accidental click must not lock the season out of setup forever
  await commish.getByTestId('start-draft').click();
  await expect(commish.getByTestId('onclock')).toContainText('On the clock');
  await commish.getByTestId('open-settings').click();
  await expect(commish.getByTestId('settings-locked')).toHaveCount(0);
  await expect(commish.getByTestId('settings-save')).toBeEnabled();
  await commish.getByRole('button', { name: 'Cancel' }).click();

  // a pick does bind one, and freezes it
  await commish.locator('[data-testid^="draft-"]').first().click();
  await commish.getByTestId('dconf-ok').click();
  await expect(commish.getByTestId('cell-1')).toContainText(/[A-Za-z]{3}/);

  await commish.getByTestId('open-settings').click();
  await expect(commish.getByTestId('settings-locked')).toContainText('frozen');
  await expect(commish.getByTestId('settings-save')).toBeDisabled();
  await expect(commish.getByTestId('set-teams')).toBeDisabled();

  await commishCtx.close();
  await teamCtx.close();
});
