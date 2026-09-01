// Phase 3 parity, end to end in two browsers: keepers (declare -> pending on
// the board -> auto-fill at draft start -> remove), trades (one-sided entry
// flags imbalance, the matching side clears it, revert works), the queue
// (star, reorder, drafted players drop off), and the Teams tab.

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

test('keepers, trades, queue and teams — full parity slice', async ({ browser }) => {
  const commishCtx = await browser.newContext();
  const teamCtx = await browser.newContext();
  const commish = await commishCtx.newPage();
  const team = await teamCtx.newPage();
  await login(commish, '1111');
  await login(team, '2202'); // Vip, slot 2

  // ---- KEEPERS: declare for Anand (slot 1) at R1 — pending 🔒 on both boards
  await commish.getByTestId('open-keepers').click();
  await commish.getByTestId('keeper-name').fill('Lamar Jackson');
  await commish.getByTestId('keeper-slot').selectOption('1');
  await commish.getByTestId('keeper-round').fill('1');
  await commish.getByTestId('keeper-add').click();
  await expect(commish.locator('[data-testid^="keeper-"]').first()).toContainText('Lamar');
  await commish.getByRole('button', { name: 'Close' }).click();
  await expect(commish.getByTestId('cell-1')).toContainText('🔒');
  await expect(team.getByTestId('cell-1')).toContainText('Lamar');

  // a keeper is invisible to the pool's buttons on the team side too
  await team.getByTestId('pool-search').fill('Lamar Jackson');
  await expect(team.locator('[data-testid^="row-"]').first()).toContainText('🔒 R1');
  await team.getByTestId('pool-search').fill('');

  // ---- TRADES: one side flags, the other side clears
  await commish.getByTestId('open-trades').click();
  await expect(commish.getByTestId('balance-ok')).toBeVisible();
  await commish.getByTestId('trade-a').selectOption('3'); // Andres
  await commish.getByTestId('trade-a-round').fill('3');
  await commish.getByTestId('trade-b').selectOption('4'); // Ryaan
  await commish.getByTestId('trade-submit').click();
  await expect(commish.getByTestId('balance-bad')).toContainText('Andres owns 19');
  await expect(team.getByTestId('balance-chip')).toBeVisible(); // followers see it too
  await commish.getByTestId('trade-b').selectOption('4');
  await commish.getByTestId('trade-b-round').fill('5');
  await commish.getByTestId('trade-a').selectOption('3');
  await commish.getByTestId('trade-submit').click();
  await expect(commish.getByTestId('balance-ok')).toBeVisible();
  await expect(team.getByTestId('balance-chip')).toHaveCount(0);
  // revert one side — imbalance returns; put it back
  await commish.getByTestId('untrade-3-3').click();
  await expect(commish.getByTestId('balance-bad')).toBeVisible();
  await commish.getByTestId('untrade-5-4').click();
  await expect(commish.getByTestId('balance-ok')).toBeVisible();
  await commish.getByRole('button', { name: 'Close' }).click();

  // ---- QUEUE (team browser): star two, reorder, drafted drops off
  // pick the first two STARRABLE rows — kept players render no star at all
  const stars = team.locator('[data-testid^="star-"]');
  const p1 = (await stars.nth(0).getAttribute('data-testid'))!.replace('star-', '');
  const p2 = (await stars.nth(1).getAttribute('data-testid'))!.replace('star-', '');
  await team.getByTestId(`star-${p1}`).click();
  await team.getByTestId(`star-${p2}`).click();
  await team.getByTestId('view-queue').click();
  await expect(team.getByTestId('view-queue')).toContainText('(2)');
  await expect(team.locator('[data-testid^="row-"]').first()).toHaveAttribute('data-testid', `row-${p1}`);
  await team.getByTestId(`qup-${p2}`).click(); // p2 moves above p1
  await expect(team.locator('[data-testid^="row-"]').first()).toHaveAttribute('data-testid', `row-${p2}`);

  // ---- start the draft: the R1 keeper AUTO-FILLS pick #1, Vip is on the clock (slot 1 skipped)
  await commish.getByTestId('start-draft').click();
  await expect(commish.getByTestId('cell-1')).toContainText('Lamar');
  await expect(commish.getByTestId('onclock')).toContainText('Vip');
  await expect(team.getByTestId('onclock')).toContainText('Vip');

  // commissioner drafts p2 — it drops off the team's queue view
  await commish.getByTestId(`draft-${p2}`).click();
  await expect(team.getByTestId('view-queue')).toContainText('(1)');
  await expect(team.locator('[data-testid^="row-"]').first()).toHaveAttribute('data-testid', `row-${p1}`);

  // ---- TEAMS TAB: rosters, keeper marked, counts
  await commish.getByTestId('tab-teams').click();
  await commish.getByTestId('team-chip-1').click();
  await expect(commish.getByTestId('team-roster')).toContainText('Lamar Jackson');
  await expect(commish.getByTestId('teams-tab')).toContainText('1/20 players');
  await commish.getByTestId('team-chip-2').click();
  await expect(commish.getByTestId('teams-tab')).toContainText('1/20 players'); // Vip got p2

  await commishCtx.close();
  await teamCtx.close();
});
