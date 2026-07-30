import type * as WebExtension from 'webextension-polyfill';

/**
 * Thin accessor for the WebExtension APIs this extension uses.
 *
 * Firefox provides a native promise-based `browser` namespace on extension
 * pages. Chrome provides `chrome`, which under MV3 returns promises from every
 * API touched here — `storage.local`, `tabs.create` and the synchronous
 * `runtime.getURL` — so one shape describes both and `webextension-polyfill` is
 * used for its type definitions only. No polyfill code ships in either build.
 *
 * Everything degrades to a no-op (or a plain `window.open`) outside an
 * extension context so the app still runs under `npm run dev` and in tests.
 */

export type BrowserApi = WebExtension.Browser;

export function getBrowserApi(): BrowserApi | null {
  if (typeof browser !== 'undefined' && browser) return browser;
  // Ordinary web pages in Chrome also carry a `chrome` object, which is not the
  // extension API. `runtime.id` exists only in an extension context, so it is
  // what distinguishes the two — without this check `vite dev` in Chrome would
  // believe it had storage APIs and silently lose every preference write.
  if (typeof chrome !== 'undefined' && chrome && typeof chrome.runtime?.id === 'string') {
    return chrome;
  }
  return null;
}

export function isExtensionContext(): boolean {
  return getBrowserApi() !== null;
}

/** URL of a packaged file, or a relative path when running outside a browser. */
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

/**
 * Which surface the app is rendering in.
 *
 * Only used for things genuinely tied to the surface — whether to offer "Full
 * page", and the fixed size a Chrome popup has to declare. The layout itself is
 * chosen by a CSS container query on width, so a 800 px popup and a 800 px
 * sidebar look the same.
 */
export type ViewMode = 'sidebar' | 'page' | 'popup';

const VIEW_MODES: readonly string[] = ['sidebar', 'page', 'popup'];

export function detectViewMode(
  search: string = window.location.search,
  pathname: string = window.location.pathname,
): ViewMode {
  const requested = new URLSearchParams(search).get('view');
  if (requested !== null && VIEW_MODES.includes(requested)) return requested as ViewMode;
  // Chrome's toolbar popup is its own document, and `action.default_popup` takes
  // a plain path, so the filename carries the surface instead of a query string.
  if (/(?:^|\/)popup\.html$/.test(pathname)) return 'popup';
  return 'sidebar';
}
