/**
 * The URL of the page the user is currently looking at, for "Pin to URL".
 *
 * This is the only part of Noutieren that can see anything outside its own
 * storage, so the rules it follows are deliberately narrow:
 *
 * - The `tabs` permission is **optional**. It is not in the manifest's required
 *   list, so it is never requested at install time and no existing user is
 *   prompted on update. It is asked for once, from a click, the first time
 *   somebody saves a pin.
 * - Without the permission this module reports `null` and every pin is inert,
 *   which the UI renders as "everything visible" rather than "everything
 *   hidden". Losing the permission mid-session is the same path, and the
 *   `permissions.onRemoved` listener means it takes effect immediately.
 * - Only the URL is read, only for the active tab of the current window, and it
 *   is never stored — not in IndexedDB, not in `storage.local`, not in a
 *   backup. It lives in React state and is gone when the view closes.
 */

import type * as WebExtension from 'webextension-polyfill';
import { getBrowserApi, type ViewMode } from './webext';
import { logError } from './errors';

/** The one optional permission this extension can ever hold. */
export const TABS_PERMISSION = 'tabs';

// Annotated rather than inferred: an array literal in an object widens to
// `string[]`, which the permissions API rightly refuses — it takes a union of
// known permission names.
const PERMISSION_REQUEST: WebExtension.Permissions.Permissions = {
  permissions: [TABS_PERMISSION],
};

export type ActiveUrlState = {
  /** The active tab's URL, or `null` when unknown or not permitted. */
  url: string | null;
  /** Whether the `tabs` permission is currently held. */
  granted: boolean;
};

/** Whether the browser has granted the optional `tabs` permission. */
export async function hasTabsPermission(): Promise<boolean> {
  const api = getBrowserApi();
  if (!api?.permissions) return false;
  try {
    return await api.permissions.contains(PERMISSION_REQUEST);
  } catch (error) {
    logError('hasTabsPermission', error);
    return false;
  }
}

/**
 * Asks the browser for the `tabs` permission.
 *
 * Must be called synchronously from a user gesture — Firefox rejects the
 * request otherwise — so callers invoke it directly in a click handler with no
 * preceding `await`.
 */
export async function requestTabsPermission(): Promise<boolean> {
  const api = getBrowserApi();
  if (!api?.permissions) return false;
  try {
    return await api.permissions.request(PERMISSION_REQUEST);
  } catch (error) {
    logError('requestTabsPermission', error);
    return false;
  }
}

/**
 * Whether the permission dialog can be raised from this surface.
 *
 * Chrome destroys the toolbar popup the moment it loses focus, which is exactly
 * what opening a permission dialog does. The document is gone before the user
 * can answer, so the promise never settles and the prompt is dismissed — from a
 * popup the request cannot merely fail, it cannot be *asked*.
 *
 * So the popup does not try. It sends the user to the full-page view, which is
 * an ordinary tab and survives losing focus, and the request is made there.
 * Firefox's sidebar has no such problem, and has no popup surface at all, so
 * this only ever diverts the Chrome build.
 */
export function canPromptForPermission(view: ViewMode): boolean {
  return view !== 'popup';
}

/** Gives the permission back. Pins survive but stop taking effect. */
export async function revokeTabsPermission(): Promise<boolean> {
  const api = getBrowserApi();
  if (!api?.permissions) return false;
  try {
    return await api.permissions.remove(PERMISSION_REQUEST);
  } catch (error) {
    logError('revokeTabsPermission', error);
    return false;
  }
}

/**
 * Reads the active tab's URL in this window.
 *
 * Returns `null` for anything that is not a web page — `about:`, `view-source:`
 * and the extension's own pages — so a pin can never be satisfied by one, and
 * so a URL the extension has no business reading is dropped at the boundary
 * rather than carried around and filtered later.
 */
async function readActiveUrl(): Promise<string | null> {
  const api = getBrowserApi();
  if (!api?.tabs) return null;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (typeof url !== 'string') return null;
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    // Thrown when the permission is absent. Not logged: this is the ordinary
    // state for anyone who has never created a pin.
    return null;
  }
}

/**
 * Watches the active tab's URL, calling `listener` whenever it changes.
 *
 * Four signals are needed to cover what users actually do, and missing any one
 * of them leaves the sidebar showing a stale answer:
 *
 * - `tabs.onActivated` — switching to another tab.
 * - `tabs.onUpdated` — the open tab navigating, including the history API, which
 *   is how a YouTube video changes without a page load.
 * - `windows.onFocusChanged` — the sidebar is per-window, so moving between
 *   windows changes which tab is "current".
 * - `permissions.onAdded` / `onRemoved` — granting starts the whole thing;
 *   revoking has to make pins inert without a reload.
 *
 * Returns an unsubscribe function. Safe to call outside an extension context,
 * where it reports "not granted" once and does nothing further.
 */
export function subscribeToActiveUrl(listener: (state: ActiveUrlState) => void): () => void {
  const api = getBrowserApi();
  if (!api) {
    listener({ url: null, granted: false });
    return () => undefined;
  }

  let cancelled = false;
  // Guards against an out-of-order resolve: several events can be in flight at
  // once, and an earlier query settling last would report a stale URL.
  let generation = 0;

  const refresh = (): void => {
    const mine = ++generation;
    void (async () => {
      const granted = await hasTabsPermission();
      const url = granted ? await readActiveUrl() : null;
      if (cancelled || mine !== generation) return;
      listener({ url, granted });
    })();
  };

  const onActivated = () => refresh();
  const onFocusChanged = () => refresh();
  const onPermissionsChanged = () => refresh();

  // Only a URL change matters here. Every other `onUpdated` reason — the title,
  // the favicon, the loading state — would re-run this several times per page
  // load for no change in the answer.
  const onUpdated = (
    _tabId: number,
    changeInfo: { url?: string },
    tab: { active?: boolean },
  ): void => {
    if (changeInfo.url === undefined) return;
    if (tab?.active !== true) return;
    refresh();
  };

  api.tabs?.onActivated.addListener(onActivated);
  api.tabs?.onUpdated.addListener(onUpdated);
  api.windows?.onFocusChanged.addListener(onFocusChanged);
  api.permissions?.onAdded.addListener(onPermissionsChanged);
  api.permissions?.onRemoved.addListener(onPermissionsChanged);

  refresh();

  return () => {
    cancelled = true;
    api.tabs?.onActivated.removeListener(onActivated);
    api.tabs?.onUpdated.removeListener(onUpdated);
    api.windows?.onFocusChanged.removeListener(onFocusChanged);
    api.permissions?.onAdded.removeListener(onPermissionsChanged);
    api.permissions?.onRemoved.removeListener(onPermissionsChanged);
  };
}
