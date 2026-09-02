// Light/dark, in one place.
//
// This used to live inside Room, which meant it only ran once somebody had
// signed in — so the public /{year} pages, which render before any session,
// never applied a theme at all and were dark for everyone regardless of what
// they had chosen inside the app. One hook, one storage key, both surfaces.
//
// v1.css carries the whole `:root[data-theme="light"]` palette, so setting
// the attribute is the entire mechanism; nothing here knows a colour.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'fa-theme';

export function useTheme(): { light: boolean; toggle: () => void } {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? '' : 'light';
      try {
        localStorage.setItem(KEY, next);
      } catch { /* private mode — the theme is a preference, not state */ }
      return next;
    });
  }, []);

  return { light: theme === 'light', toggle };
}
