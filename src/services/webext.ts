import type * as WebExtension from 'webextension-polyfill';

/**
 * Thin accessor for the WebExtension APIs this extension uses.
 *
 * Firefox provides a native promise-based `browser` namespace on extension
 * pages, so `webextension-polyfill` is used for its type definitions only and
 * no polyfill code is shipped. Everything degrades to a no-op (or a plain
 * `window.open`) outside an extension context so the app still runs under
 * `npm run dev` and in tests.
 */

export type BrowserApi = WebExtension.Browser;

export function getBrowserApi(): BrowserApi | null {
  return typeof browser !== 'undefined' && browser ? browser : null;
}

export function isExtensionContext(): boolean {
  return getBrowserApi() !== null;
}

/** URL of a packaged file, or a relative path when running outside Firefox. */
export function extensionUrl(path: string): string {
  const api = getBrowserApi();
  return api ? api.runtime.getURL(path) : path;
}

export const FULL_PAGE_URL = 'index.html?view=page';

/**
 * Opens the full-page editor in a normal browser tab.
 *
 * Always creates a tab rather than looking for an existing one: filtering
 * `tabs.query` by URL needs the `tabs` permission, which this extension does
 * not request, and without it the filter can be ignored — which would mean
 * activating an unrelated tab. `tabs.create` needs no permission at all.
 */
export async function openFullPageEditor(): Promise<void> {
  const api = getBrowserApi();
  if (!api) {
    window.open(FULL_PAGE_URL, '_blank', 'noopener');
    return;
  }
  await api.tabs.create({ url: api.runtime.getURL(FULL_PAGE_URL) });
}

/** Which surface the app is rendering in. Layout itself is width-driven. */
export type ViewMode = 'sidebar' | 'page';

export function detectViewMode(search: string = window.location.search): ViewMode {
  return new URLSearchParams(search).get('view') === 'page' ? 'page' : 'sidebar';
}
