// One-line access to the View Transitions API, with the two guards it always
// needs: browsers that do not have it, and people who have asked for less
// motion. Both fall through to applying the change immediately, so a caller
// never has to think about it.
//
// No library, no bundle: this is ~10 lines against the 18-34KB a motion
// library would have cost to do the same job.

export function withViewTransition(apply: () => void): void {
  const reduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // `startViewTransition` is typed as always-present by lib.dom but is not,
  // so this is a real runtime check rather than a formality
  if (reduced || typeof document.startViewTransition !== 'function') {
    apply();
    return;
  }
  document.startViewTransition(apply);
}
