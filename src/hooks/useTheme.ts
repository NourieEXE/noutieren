import { useEffect } from 'react';
import type { ThemePreference } from '../types';

/**
 * Applies the theme preference to the document root.
 *
 * `system` follows `prefers-color-scheme` live; explicit choices win. The
 * resolved value is written to `data-theme` so CSS can key off it in both
 * directions without duplicating every rule inside a media query.
 */
export function useTheme(preference: ThemePreference): void {
  useEffect(() => {
    const root = document.documentElement;

    if (preference !== 'system') {
      root.dataset.theme = preference;
      root.style.colorScheme = preference;
      return undefined;
    }

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = query.matches ? 'dark' : 'light';
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [preference]);
}
