// Exports: the xlsx download is a real OOXML workbook built client-side,
// and the MFL panel maps slots to franchises by OWNER (never team name),
// builds v1's draftResults XML, and pushes through the proxy. The proxy is
// stubbed here — e2e must not depend on MyFantasyLeague being reachable —
// so what's under test is everything client-side: the panel, the guessed
// franchise mapping, the XML shape, and the push wire.

import { readFileSync } from 'node:fs';
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

const FRANCHISES = [
  ['0001', 'Smells Like GOAT'], ['0002', 'Ryaan'], ['0003', '3rd and 1'],
  ['0004', 'The Don is Yinz King'], ['0005', 'I\'m Just Here to Network'],
  ['0006', '2-minute Drill'], ['0007', 'High Flyers'], ['0008', 'WhiskeyDitka'],
  ['0009', 'Vip'], ['0010', 'Boyz II Menezes'], ['0011', 'Lil\' Sosos'],
].map(([id, name]) => ({ id, name }));

test('xlsx download and the MFL panel (proxy stubbed)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());

  // stub the MFL proxy: setup matches every player but the LAST drafted one;
  // push succeeds
  await page.route('**/api/mfl', async (route) => {
    const body = route.request().postDataJSON() as {
      op: string; players?: { id: string }[];
    };
    if (body.op === 'setup') {
      const players = body.players ?? [];
      const map: Record<string, string> = {};
      players.slice(0, -1).forEach((p, i) => (map[p.id] = String(10000 + i)));
      await route.fulfill({
        json: {
          leagueName: 'INDOMEXPAK TEST', franchises: FRANCHISES,
          map, unmatched: players.slice(-1),
        },
      });
    } else {
      await route.fulfill({ json: { status: 200, response: 'OK' } });
    }
  });

  await login(page, '1111');
  await page.getByTestId('start-draft').click();

  // two real picks so there's something to export
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-testid^="draft-"]').first().click();
    await page.getByTestId('dconf-ok').click();
    await expect(page.getByTestId(`cell-${i + 1}`)).toContainText(/[A-Za-z]{3}/);
  }

  // ---- the Excel export downloads a real workbook
  const dlPromise = page.waitForEvent('download');
  await page.getByTestId('xlsx-btn').click();
  const dl = await dlPromise;
  expect(dl.suggestedFilename()).toBe('fa-draft-2027.xlsx');
  const bytes = readFileSync((await dl.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a real ZIP
  expect(bytes.includes('xl/workbook.xml')).toBe(true);

  // ---- the MFL panel: owner-keyed franchise guesses land on their ids
  await page.getByTestId('open-mfl').click();
  await expect(page.getByTestId('mfl-status')).toContainText('INDOMEXPAK TEST');
  await expect(page.getByTestId('mfl-fr-1')).toHaveValue('0010'); // Anand
  await expect(page.getByTestId('mfl-fr-11')).toHaveValue('0001'); // Shak
  await expect(page.getByTestId('mfl-unmatched')).toContainText('1 drafted player(s) had no MFL match');

  // ---- Download XML carries v1's draftResults shape
  const xmlPromise = page.waitForEvent('download');
  await page.getByTestId('mfl-download').click();
  const xml = readFileSync((await (await xmlPromise).path())!).toString();
  expect(xml).toContain('<draftResults>');
  expect(xml).toContain('round1DraftOrder="0010,0009,0006,0002,0008,0005,0007,0004,0003,0011,0001,"');
  expect(xml).toContain('round="01" pick="01" franchise="0010" player="10000"');
  expect(xml).toContain('pick="02" franchise="0009" player=""'); // the unmatched one

  // ---- push goes through the proxy and reports success
  await page.getByTestId('mfl-user').fill('commish');
  await page.getByTestId('mfl-pass').fill('hunter2');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('mfl-push-btn').click();
  await expect(page.getByTestId('mfl-status')).toContainText('✓ Draft results pushed to MFL');
  await page.getByTestId('mfl-panel').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('mfl-panel')).toHaveCount(0);

  // ---- Past Drafts: the committed 2026 archive renders, and the current
  // draft archives to the same document shape
  await page.getByTestId('tab-archive').click();
  await page.getByTestId('archive-2026').click();
  await expect(page.locator('#archive-doc')).toContainText('220 picks');
  await expect(page.locator('#archive-doc .bc-last').first()).toContainText('Gibbs');
  await expect(page.locator('#archive-doc')).toContainText('Every team finished on 20 players');

  page.once('dialog', (d) => void d.accept()); // "2 of 220 picks — archive as-is?"
  const arcPromise = page.waitForEvent('download');
  await page.getByTestId('archive-now').click();
  const arc = await arcPromise;
  expect(arc.suggestedFilename()).toBe('fa-draft-2027.json');
  const doc = JSON.parse(readFileSync((await arc.path())!).toString()) as {
    kind: string; season: number; picks: unknown[]; complete: boolean;
  };
  expect(doc.kind).toBe('imp-draft-archive');
  expect(doc.season).toBe(2027);
  expect(doc.picks).toHaveLength(2);
  expect(doc.complete).toBe(false);

  await ctx.close();
});
