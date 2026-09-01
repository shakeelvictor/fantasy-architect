// The Phase 2 exit criteria, executable: two real browsers — commissioner
// and a team — against the real migration. A pick made in one appears in the
// other in under a second; killing the network mid-pick loses nothing; the
// Take-it/Reject flow lands a team's ask as a real pick.

import { expect, test, type Page } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  await request.post('http://localhost:8787/reset?season=2027');
});

async function login(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('conn')).toContainText('live');
}

test('a full slice of draft night, in two browsers', async ({ browser }) => {
  const commishCtx = await browser.newContext();
  const teamCtx = await browser.newContext();
  const commish = await commishCtx.newPage();
  const team = await teamCtx.newPage();

  await login(commish, '1111'); // commissioner
  await login(team, '2202'); // slot 2 — Vip

  // ---- start the draft; both browsers see it
  await commish.getByTestId('start-draft').click();
  await expect(commish.getByTestId('onclock')).toContainText('Anand');
  await expect(team.getByTestId('onclock')).toContainText('Anand');

  // ---- commissioner drafts the top player; the team browser sees it FAST
  const topRow = commish.locator('[data-testid^="row-"]').first();
  // innerText merges the inline <small>, so only the first token is safe
  const firstName = (await topRow.locator('.p-name').innerText()).split(/\s/)[0]!;
  await topRow.locator('[data-testid^="draft-"]').click();
  // the confirm card quotes the pick; OK commits it
  await expect(commish.locator('.dconf-label')).toContainText('Pick 1.01');
  await commish.getByTestId('dconf-ok').click();
  const t0 = Date.now();
  await expect(team.getByTestId('cell-1')).toContainText(firstName, { timeout: 1000 });
  const propagation = Date.now() - t0;
  console.log(`propagation: ${propagation}ms`);
  await expect(commish.getByTestId('onclock')).toContainText('Vip');

  // ---- the ticker scrolls the pick and who's on the clock, both browsers
  await expect(commish.locator('#pick-ticker')).toContainText(firstName.toUpperCase());
  await expect(team.locator('#pick-ticker')).toContainText('ON THE CLOCK');

  // ---- the team asks for a player; commissioner takes it
  // data-independent: whoever tops the available list after pick #1
  const askBtn = team.locator('[data-testid^="ask-"]').first();
  const askedPid = (await askBtn.getAttribute('data-testid'))!.replace('ask-', '');
  const askedName = (await team.getByTestId(`row-${askedPid}`).locator('.p-name').innerText()).split(/\s/)[0]!;
  await askBtn.click();
  await expect(team.getByTestId(`ask-${askedPid}`)).toContainText('Asked');
  await expect(commish.getByTestId('req-banner')).toContainText('Vip');
  await expect(commish.getByTestId('req-banner')).toContainText(askedName);
  await commish.getByTestId('req-accept').click();
  await expect(team.getByTestId('cell-2')).toContainText(askedName);
  await expect(commish.getByTestId('cell-2')).toContainText(askedName);

  // ---- authorization on the wire: the team's own UI offers Ask, never Draft
  await expect(team.locator('[data-testid^="draft-"]')).toHaveCount(0);

  // ---- undo propagates too
  await commish.getByTestId('undo').click();
  await expect(team.getByTestId('cell-2')).not.toContainText(askedName);
  await expect(commish.getByTestId('onclock')).toContainText('Vip');

  // ---- redo is a compensating pick_made: the same player comes right back
  await commish.getByTestId('redo').click();
  await expect(commish.getByTestId('cell-2')).toContainText(askedName);
  await expect(team.getByTestId('cell-2')).toContainText(askedName);
  await commish.getByTestId('undo').click();
  await expect(commish.getByTestId('cell-2')).not.toContainText(askedName);
  await expect(team.getByTestId('cell-2')).not.toContainText(askedName);

  // ---- kill the network mid-pick: the pick fails LOUDLY, nothing corrupts
  await commishCtx.setOffline(true);
  // (the idle SSE socket only notices on its next heartbeat — the loud
  // failure below is the exit criterion, not the indicator's timing)
  await commish.locator('[data-testid^="draft-"]').first().click();
  await commish.getByTestId('dconf-ok').click();
  await expect(commish.getByTestId('toast')).toBeVisible();
  await expect(commish.getByTestId('cell-2')).not.toContainText(askedName);

  // ---- back online: reconnects, converges, and the pick goes through clean
  await commishCtx.setOffline(false);
  await expect(commish.getByTestId('conn')).toContainText('live', { timeout: 10_000 });
  await commish.locator('[data-testid^="draft-"]').first().click();
  await commish.getByTestId('dconf-ok').click();
  await expect(commish.getByTestId('cell-2')).toContainText(askedName);
  await expect(team.getByTestId('cell-2')).toContainText(askedName);

  // exactly two picks on both boards — the offline failure left no residue
  for (const page of [commish, team]) {
    await expect(page.locator('[data-testid^="cell-"]').locator('text=🔒')).toHaveCount(0);
    await expect(page.getByTestId('cell-3')).not.toContainText(/[A-Za-z]{3}/);
  }

  await commishCtx.close();
  await teamCtx.close();
});
