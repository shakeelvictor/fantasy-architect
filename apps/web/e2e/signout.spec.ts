// Signing out mid-draft, for both roles.
//
// The claim this makes good on is the app's whole reason for existing: the
// board is the server's event log, so a client forgetting its PIN cannot
// cost anything. v1's failure was the opposite — an empty browser could
// overwrite a finished draft — so "what happens if someone hits the power
// icon at 9pm on draft night" deserves a test rather than a reassurance.

import { expect, test, type Page } from '@playwright/test';

// beforeEACH: the first test starts the draft and leaves picks on the board,
// and the second one is specifically about the pre-draft case
test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:8787/reset?season=2027');
});

async function login(page: Page, pin: string): Promise<void> {
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('conn')).toContainText('live');
}

async function open(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await login(page, pin);
}

test('a mid-draft sign-out costs the board nothing — commissioner and team', async ({ browser }) => {
  const commishCtx = await browser.newContext();
  const teamCtx = await browser.newContext();
  const commish = await commishCtx.newPage();
  const team = await teamCtx.newPage();
  for (const p of [commish, team]) await p.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());

  await open(commish, '1111');
  await open(team, '2202'); // Vip, slot 2
  await commish.getByTestId('start-draft').click();

  // three real picks on the board
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    const row = commish.locator('[data-testid^="row-"]').first();
    names.push((await row.locator('.p-name').innerText()).split('\n')[0]!.trim());
    await row.locator('[data-testid^="draft-"]').click();
    await commish.getByTestId('dconf-ok').click();
    await expect(commish.getByTestId(`cell-${i + 1}`)).toContainText(/[A-Za-z]{3}/);
  }

  // the team stars two players — a per-browser list, the thing most likely
  // to be quietly lost by a sign-out
  await team.getByTestId('pool-search').fill('Josh');
  const starred = await team.locator('[data-testid^="row-"]').first().getAttribute('data-pid');
  await team.locator('[data-testid^="star-"]').first().click();
  await expect(team.getByTestId('view-queue')).toContainText('(1)');
  await team.getByTestId('pool-search').fill('');

  // ---- A) the COMMISSIONER signs out mid-draft
  // Capture the message and assert AFTER the click. Asserting inside the
  // handler proves nothing: with no dialog the handler never runs, so
  // deleting the confirm outright would leave every check unexecuted and
  // the test green.
  let asked: string | null = null;
  commish.once('dialog', (d) => { asked = d.message(); void d.accept(); });
  await commish.getByTestId('sign-out').click();
  await expect(commish.getByTestId('pin-input')).toBeVisible();
  expect(asked, 'a live draft must ask before signing out').toContain('commissioner');
  // Tie the assertion to the BEHAVIOUR the sentence claims, not to a stock
  // phrase. The previous version checked for "Nothing is lost", which stayed
  // true and green while the sentence beside it ("no one else can make
  // picks") was made false by teams drafting for themselves.
  expect(asked, 'the prompt must not claim the board stalls — teams draft now')
    .toContain('teams draft their own picks');

  // the team's board is untouched while the commissioner is away — the draft
  // carries on existing, it just cannot advance
  await expect(team.getByTestId('cell-1')).toContainText(names[0]!.split(/\s/)[0]!);
  await expect(team.getByTestId('cell-3')).toContainText(names[2]!.split(/\s/)[0]!);

  // signing back in rebuilds the identical board from the log
  await login(commish, '1111');
  for (let i = 0; i < 3; i++) {
    await expect(commish.getByTestId(`cell-${i + 1}`)).toContainText(names[i]!.split(/\s/)[0]!);
  }
  await expect(commish.getByTestId('onclock')).toContainText('Pick 1.04');

  // and the draft still advances — nothing latched
  await commish.locator('[data-testid^="draft-"]').first().click();
  await commish.getByTestId('dconf-ok').click();
  await expect(commish.getByTestId('cell-4')).toContainText(/[A-Za-z]{3}/);
  await expect(team.getByTestId('cell-4')).toContainText(/[A-Za-z]{3}/);

  // ---- B) a TEAM signs out mid-draft
  let teamAsked: string | null = null;
  team.once('dialog', (d) => { teamAsked = d.message(); void d.accept(); });
  await team.getByTestId('sign-out').click();
  await expect(team.getByTestId('pin-input')).toBeVisible();
  expect(teamAsked, 'a team mid-draft must be asked too').toContain('your queue');
  expect(teamAsked).toContain('your own picks');
  await login(team, '2202');

  // four picks still there, and the starred queue survived — it is a
  // per-browser list under its own key, never the session's
  for (let i = 0; i < 4; i++) {
    await expect(team.getByTestId(`cell-${i + 1}`)).toContainText(/[A-Za-z]{3}/);
  }
  await expect(team.getByTestId('view-queue')).toContainText('(1)');
  await expect(team.locator(`[data-testid="star-${starred}"]`)).toHaveText('★');

  // the log itself is the proof: 1 start + 4 picks, nothing reset, nothing doubled
  const events = await team.evaluate(async () =>
    (await (await fetch('/api/events?season=2027')).json()).events as { type: string }[]);
  expect(events.filter((e) => e.type === 'pick_made')).toHaveLength(4);
  expect(events.filter((e) => e.type === 'draft_started')).toHaveLength(1);

  await commishCtx.close();
  await teamCtx.close();
});

test('signing out before the draft starts asks nothing', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await open(page, '1111');

  // no draft in progress, so no interruption to warn about — a prompt here
  // would just be noise, and noise is how prompts stop being read
  let asked = false;
  page.on('dialog', (d) => { asked = true; void d.accept(); });
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('pin-input')).toBeVisible();
  expect(asked).toBe(false);

  await ctx.close();
});
