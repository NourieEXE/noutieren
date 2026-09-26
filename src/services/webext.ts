import type * as WebExtension from 'webextension-polyfill';
import { isValidId } from '../utils/id';

/**
 * Thin accessor for the WebExtension APIs this extension uses.
 *
 * Firefox provides a native promise-based `browser` namespace on extension
 * pages. Chrome provides `chrome`, which under MV3 returns promises from every
 * API touched here (`storage.local`, `tabs.create` and the synchronous
 * `runtime.getURL`), so one shape describes both and `webextension-polyfill` is
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
  // what distinguishes the two. Without this check `vite dev` in Chrome would
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
 * Why a full-page tab was opened to ask for a permission. Chrome's toolbar
 * popup cannot raise a permission dialog (see `canPromptForPermission`), so it
 * sends the user here, and the tab leads with the request.
 */
export type GrantReason = 'pins' | 'reminders';

const GRANT_PARAM = 'grant';
const GRANT_REASONS: readonly string[] = ['pins', 'reminders'];

/** Set when a reminder notification opens the full page on its note. */
const NOTE_PARAM = 'note';

export function requestedGrant(search: string = window.location.search): GrantReason | null {
  const value = new URLSearchParams(search).get(GRANT_PARAM);
  return value !== null && GRANT_REASONS.includes(value) ? (value as GrantReason) : null;
}

/** Whether this document was opened to ask for the pin permission. */
export function wantsPinPermissionGrant(search: string = window.location.search): boolean {
  return requestedGrant(search) === 'pins';
}

export function requestedNoteId(search: string = window.location.search): string | null {
  const value = new URLSearchParams(search).get(NOTE_PARAM);
  return isValidId(value) ? value : null;
}

export interface FullPageOptions {
  grant?: GrantReason;
  noteId?: string;
}

/** The full-page path, relative to the extension root. */
export function fullPagePath({ grant, noteId }: FullPageOptions = {}): string {
  let path = FULL_PAGE_URL;
  if (grant) path += `&${GRANT_PARAM}=${grant}`;
  if (noteId) path += `&${NOTE_PARAM}=${encodeURIComponent(noteId)}`;
  return path;
}

/**
 * Opens the full-page editor in a normal browser tab.
 *
 * Always creates a tab rather than looking for an existing one: filtering
 * `tabs.query` by URL needs the `tabs` permission, which is optional and
 * usually absent, and without it the filter can be ignored, which would mean
 * activating an unrelated tab. `tabs.create` needs no permission at all.
 */
export async function openFullPageEditor(options: FullPageOptions = {}): Promise<void> {
  const path = fullPagePath(options);
  const api = getBrowserApi();
  if (!api) {
    window.open(path, '_blank', 'noopener');
    return;
  }
  await api.tabs.create({ url: api.runtime.getURL(path) });
}

/**
 * Which surface the app is rendering in.
 *
 * Only used for things genuinely tied to the surface: whether to offer "Full
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
