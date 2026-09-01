// The MFL push, guarded for real.
//
// Sending draft results REPLACES every existing result in the MFL league, so
// it is the most destructive thing this app can reach. exports.spec stubs the
// proxy to test the panel, which means the actual route had never run in a
// test — this drives the real one on the dev API, which applies the very same
// authorizePush() the hosted edge function does.
//
// Nothing here can reach MyFantasyLeague: every request is either rejected at
// the gate, or rejected for missing credentials immediately after it.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:8787';

async function tokenFor(request: Page['request'], pin: string): Promise<string> {
  const res = await request.post(`${API}/auth`, { data: { season: 2027, pin } });
  expect(res.ok()).toBe(true);
  return (await res.json()).token as string;
}

test('only a commissioner can push draft results', async ({ playwright }) => {
  const request = await playwright.request.newContext();

  const push = (token?: string) => request.post(`${API}/mfl`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    data: { op: 'push', season: 2027, username: 'u', password: 'p', xml: '<draftResults/>' },
  });

  // a team PIN is refused
  const team = await tokenFor(request, '2202');
  const asTeam = await push(team);
  expect(asTeam.status()).toBe(403);
  expect((await asTeam.json()).error).toBe('commissioner only');

  // so is a spectator with no token at all
  expect((await push()).status()).toBe(403);

  // and so is a made-up one
  const forged = await request.post(`${API}/mfl`, {
    headers: { authorization: 'Bearer not.a.token' },
    data: { op: 'push', season: 2027, username: 'u', password: 'p', xml: '<x/>' },
  });
  expect(forged.status()).toBe(403);

  // The commissioner gets THROUGH the gate — proven by the next check being
  // the one about missing credentials rather than another 403. Sending real
  // credentials is what would actually reach MFL, so the test stops here.
  const commish = await tokenFor(request, '1111');
  const incomplete = await request.post(`${API}/mfl`, {
    headers: { authorization: `Bearer ${commish}` },
    data: { op: 'push', season: 2027 },
  });
  expect(incomplete.status()).toBe(400);
  expect((await incomplete.json()).error).toMatch(/username, password, and xml/);

  await request.dispose();
});

test('a team never even sees the way to MFL', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('pin-input').fill('2202'); // Vip, slot 2
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('conn')).toContainText('live');

  // the whole Export card is the commissioner's
  await expect(page.getByTestId('open-mfl')).toHaveCount(0);
  await expect(page.getByTestId('xlsx-btn')).toHaveCount(0);

  await ctx.close();
});
