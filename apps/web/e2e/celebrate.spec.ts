// The pick celebration and the board's headshots — the two bits of v1's
// draft-night texture. The league's whole personality lives in the NFC North
// rule: a Bears pick gets the fight song, and the other three division clubs
// get pelted. Chicago is itself in the division, so it must be checked FIRST
// and never fall through to the rival treatment — that ordering is the thing
// most likely to break silently, so it is asserted directly.

import { expect, test, type Locator, type Page } from '@playwright/test';

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

/** Draft the top available player on a given NFL team, through the confirm
 *  card. Filtering on the row's own meta line rather than the search term
 *  keeps this honest — searching "CHI" also matches names like Chinn. */
async function draftFrom(page: Page, team: string): Promise<string> {
  await page.getByTestId('pool-search').fill(team);
  const row: Locator = page.locator('[data-testid^="row-"]')
    .filter({ hasText: new RegExp(`${team} · `) }).first();
  await expect(row).toBeVisible();
  const name = (await row.locator('.p-name').innerText()).trim().split(/\s+/).slice(-1)[0]!;
  await row.locator('[data-testid^="draft-"]').click();
  await page.getByTestId('dconf-ok').click();
  return name;
}

test('pick celebrations and board headshots', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // headshots and logos are Sleeper CDN; the pop and the board must not
  // depend on them loading
  await page.route(/sleepercdn\.com/, (r) => r.abort());
  await page.route(/sleeper\.app/, (r) => r.abort());
  await login(page, '1111');
  await page.getByTestId('start-draft').click();

  const pop = page.locator('#pick-pop');

  // ---- a Bears pick gets the fight song
  const bear = await draftFrom(page, 'CHI');
  await expect(pop).toHaveClass(/pp-bears/);
  await expect(pop).toContainText('BEAR DOWN!');
  await expect(pop).toContainText(bear);
  // Chicago is in the NFC North but must never take the rival treatment
  await expect(pop).not.toHaveClass(/pp-rival/);

  // ---- the other three division clubs get pelted
  for (const rival of ['GB', 'DET', 'MIN']) {
    await draftFrom(page, rival);
    await expect(pop).toHaveClass(/pp-rival/);
    await expect(pop).toContainText('DIVISION RIVAL');
    await expect(pop).not.toHaveClass(/pp-bears/);
  }

  // ---- everyone else gets the plain card
  await draftFrom(page, 'BUF');
  await expect(pop).toHaveClass(/pick-pop/);
  await expect(pop).not.toHaveClass(/pp-bears|pp-rival|pp-long/);

  // ---- the overlay can never swallow a click on the board underneath
  await expect(pop).toHaveCSS('pointer-events', 'none');

  // ---- the board carries the headshot and v1's stacked name
  await page.getByTestId('pool-search').fill('');
  await page.getByTestId('tab-board').click();
  const cell = page.getByTestId('cell-1');
  await expect(cell).toHaveClass(/has-shot/);
  await expect(cell.locator('img.bc-shot')).toHaveCount(1);
  await expect(cell.locator('.bc-last')).toContainText(bear);
  // an empty cell gets neither
  await expect(page.getByTestId('cell-99')).not.toHaveClass(/has-shot/);
  await expect(page.getByTestId('cell-99').locator('img.bc-shot')).toHaveCount(0);

  await ctx.close();
});
