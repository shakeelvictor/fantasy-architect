// The topbar's two MEASURED behaviors, ported from v1's app.js
// (trackTopbarHeight + fitBrandWordmark). v1.css already contains both
// hooks — `--topbar-h` and `#league-name.no-room` — so without this the
// sticky tab bar falls back to `top: 0px` and slides under the header, and
// the wordmark overflows into the mode switch instead of yielding to the
// [FA] badge.

import { useEffect } from 'react';

/** `ready` must be false while the room still renders its loading screen —
 *  the topbar does not exist in the DOM until after that, and an effect that
 *  measured it then would find nothing and, with a stable dep list, never
 *  look again. */
export function useTopbarFit(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const bar = document.querySelector<HTMLElement>('.topbar');
    const brand = document.querySelector<HTMLElement>('.brand');
    const badge = document.querySelector<HTMLElement>('.brand-mark');
    const name = document.getElementById('league-name');
    if (!bar || !brand || !badge || !name) return;

    // The mobile tab bar sticks to `var(--topbar-h)`. The topbar wraps at
    // narrow widths and the clock banner is a row that comes and goes, so
    // its height has to be measured rather than assumed.
    const syncHeight = (): void => {
      document.documentElement.style.setProperty(
        '--topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    };

    // Show the brand wordmark only when it genuinely fits, and hide it when
    // it does not so the [FA] badge carries the brand alone.
    //
    // A viewport breakpoint cannot answer this — v2's topbar carries a live
    // indicator and a sign-out button that v1's did not, so at an identical
    // width it has less room than v1 had. Measuring the space the brand is
    // actually given handles that, and keeps working when the clock banner
    // appears, when a team name is longer than expected, or when the display
    // font swaps in late.
    //
    // This does not oscillate: below 820px `.brand` is `flex: 1; min-width: 0`,
    // so its width is whatever the other controls leave over — it does NOT
    // depend on whether the wordmark is showing, so the measurement's input is
    // independent of its own output. Above 820px `.brand` sizes to its content
    // instead, which WOULD feed back, so this is confined to the phone layout
    // where there is no room problem to solve anyway.
    const phone = window.matchMedia('(max-width: 820px)');
    const syncBrand = (): void => {
      if (!phone.matches) { name.classList.remove('no-room'); return; }
      name.classList.remove('no-room'); // measure with it shown, then decide
      const gap = parseFloat(getComputedStyle(brand).columnGap) || 0;
      // scrollWidth is the UNCLIPPED text width, so this asks "would it fit"
      // rather than "is it currently clipped"
      const needed = badge.offsetWidth + gap + name.scrollWidth;
      name.classList.toggle('no-room', needed > brand.clientWidth);
    };

    const sync = (): void => {
      syncBrand();
      syncHeight(); // after the brand, whose visibility can change the height
    };

    const ro = window.ResizeObserver ? new ResizeObserver(sync) : null;
    if (ro) {
      ro.observe(bar);
      ro.observe(brand);
    } else {
      window.addEventListener('resize', sync);
    }
    phone.addEventListener('change', sync);
    // Archivo arrives after first paint and is wider than the fallback, so a
    // wordmark measured before the swap can be measured as fitting and then
    // overflow once it lands.
    void document.fonts?.ready.then(sync).catch(() => undefined);
    sync();

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', sync);
      phone.removeEventListener('change', sync);
      document.documentElement.style.removeProperty('--topbar-h');
    };
  }, [ready]);
}
