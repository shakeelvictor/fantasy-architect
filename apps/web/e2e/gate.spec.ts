// The PIN screen. It is the first thing anyone touches on draft night and had
// no direct coverage, so this pins the two paths that matter: a wrong PIN
// says so and keeps you out, a right one lets you in.

import { expect, test } from '@playwright/test';

test('the PIN gate rejects a wrong PIN and admits a right one', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // the error line holds its space from the start, so the button never jumps
  const err = page.getByTestId('gate-error');
  await expect(err).toHaveText('');
  const boxBefore = await err.boundingBox();

  await page.getByTestId('pin-input').fill('0000');
  await page.getByTestId('pin-submit').click();
  await expect(err).toContainText(/PIN/i);
  expect((await err.boundingBox())?.y).toBe(boxBefore?.y);
  await expect(page.getByTestId('pin-input')).toBeVisible(); // still locked out

  await page.getByTestId('pin-input').fill('1111');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('conn')).toContainText('live');
  await expect(page.getByTestId('pin-input')).toHaveCount(0);

  await ctx.close();
});
