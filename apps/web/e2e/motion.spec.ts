// Motion, done with the platform rather than a library.
//
// Two things need guarding and neither is visible by eye. @starting-style is
// silent when it does not apply — a typo means no animation and no error, so
// the settle is asserted rather than assumed. And the performance promise is
// that only opacity and transform are animated: those the compositor handles
// off the main thread, while a width or top would cost a layout pass per
// frame on someone's phone mid-draft.

import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('pin-input').fill(pin);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('conn')).toContainText('live');
}

test('panels animate in, and settle', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(page, '1111');

  await page.getByTestId('open-keepers').click();
  const card = page.getByTestId('keepers-panel');

  // The mechanism itself. Asserting the settled state alone proves nothing:
  // delete the @starting-style and the panel simply appears at its end state,
  // which passes every after-the-fact check while the animation is gone. So
  // look for the rule in the loaded CSSOM.
  // Scoped to THIS panel's own (CSS-module-hashed) class — a global scan
  // passes on any other element's starting style, which is how the first
  // version of this check quietly matched the Gate instead.
  const startingStyle = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="keepers-panel"]')!;
    const own = Array.from(el.classList);
    const found: string[] = [];
    const walk = (rules: CSSRuleList): void => {
      for (const r of Array.from(rules)) {
        if (r.constructor.name === 'CSSStartingStyleRule'
          && own.some((c) => r.cssText.includes(`.${c}`))) found.push(r.cssText);
        const nested = (r as CSSGroupingRule).cssRules;
        if (nested) walk(nested);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try { walk(sheet.cssRules); } catch { /* cross-origin, not ours */ }
    }
    return found.join(' ');
  });
  expect(startingStyle).toMatch(/opacity:\s*0/);
  expect(startingStyle).toMatch(/translateY\(8px\)/);

  // compositor-only: the whole reason this costs nothing to run
  await expect(card).toHaveCSS('transition-property', 'opacity, transform');

  // and it actually arrives. A stuck @starting-style would leave this at 0
  // forever and look, from a screenshot, exactly like a panel that never opened
  await expect(card).toHaveCSS('opacity', '1');
  // the identity matrix — proof it travelled the whole way from the
  // translateY(8px) scale(.985) that @starting-style paints it at first
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

  await ctx.close();
});

test('reduced motion turns it off, matching v1.css', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(page, '1111');

  await page.getByTestId('open-keepers').click();
  const card = page.getByTestId('keepers-panel');
  await expect(card).toHaveCSS('transition-duration', '0s');
  await expect(card).toHaveCSS('opacity', '1'); // still opens, just without the flourish

  await ctx.close();
});

test('the pool cross-fades when it re-orders, and still re-orders', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/sleeper(cdn)?\.(app|com)/, (r) => r.abort());
  await login(page, '1111');

  // named so the browser animates the TABLE rather than cross-fading the
  // whole page behind it
  await expect(page.locator('.pool-table-wrap')).toHaveCSS('view-transition-name', 'pool');

  // and the animation must not have eaten the interaction it wraps: the
  // state change happens inside the browser's snapshot callback, so a
  // mistake here would leave the board looking sorted but ordered wrongly
  const first = () => page.locator('[data-testid^="row-"]').first();
  // proj, not adp: Gibbs happens to top the board AND have the lowest ADP, so
  // sorting by ADP legitimately leaves the same name on top and proves nothing
  const byBoard = await first().locator('.p-name').innerText();
  await page.locator('th[data-sort="proj"]').click();
  await expect
    .poll(async () => (await first().locator('.p-name').innerText()))
    .not.toBe(byBoard);

  // and a filter still filters
  await page.getByTestId('pos-QB').click();
  await expect(first().locator('.p-meta')).toContainText('QB');

  await ctx.close();
});

test('the news rail fades its edge from scroll, with no JS driving it', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/sleepercdn\.com/, (r) => r.abort());
  await login(page, '1111');
  await page.locator('[data-testid^="row-"]').first().click();
  await expect(page.getByTestId('player-drawer')).toBeVisible();

  // the rail publishes a timeline; the veil on the column borrows it
  await expect(page.locator('#pc-news-rail')).toHaveCSS('scroll-timeline-name', '--rail');
  await expect(page.locator('.pc-news')).toHaveCSS('timeline-scope', '--rail');

  // The veil must be driven by that scroll, not by a class someone keeps in
  // sync. Assert the strongest thing each engine can actually tell us:
  // Chromium exposes the pseudo-element's animation through getAnimations()
  // and names its timeline ScrollTimeline. WebKit returns the animation but
  // leaves .timeline undefined, so it cannot answer that question at all —
  // there the computed wiring is the evidence. Assert whatever each engine
  // is actually able to tell us rather than the lowest common denominator.
  const veil = await page.evaluate(() => {
    const col = document.querySelector('.pc-news')!;
    const after = getComputedStyle(col, '::after');
    return {
      animation: after.animationName,
      timeline: after.animationTimeline,
      exposed: col.getAnimations({ subtree: true })
        .map((a) => a.timeline?.constructor?.name),
    };
  });
  expect(veil.animation).toBe('rail-veil');
  expect(veil.timeline).toBe('--rail');
  const namedTimelines = veil.exposed.filter(Boolean);
  if (namedTimelines.length) expect(namedTimelines).toContain('ScrollTimeline');

  await ctx.close();
});
