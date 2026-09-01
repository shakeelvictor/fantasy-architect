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
