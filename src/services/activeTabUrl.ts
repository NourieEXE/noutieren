/**
 * The active tab's URL, for "Pin to URL".
 *
 * The `tabs` permission is optional, so it is never requested at install and
 * pins are inert until it is granted. Only the URL is read, only for the active
 * tab of the current window, and it is never stored anywhere.
 */

import type * as WebExtension from 'webextension-polyfill';
import { getBrowserApi, type ViewMode } from './webext';
import { logError } from './errors';

export const TABS_PERMISSION = 'tabs';

// Annotated because an array literal widens to `string[]`, which the
// permissions API refuses.
const PERMISSION_REQUEST: WebExtension.Permissions.Permissions = {
  permissions: [TABS_PERMISSION],
};

export type ActiveUrlState = {
  url: string | null;
  granted: boolean;
};

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

/** Must be called from a user gesture, or Firefox rejects it. */
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
 * Chrome destroys the toolbar popup when it loses focus, which is what opening
 * a dialog does, so the promise never settles. The popup sends the user to the
 * full-page view instead. Firefox has no popup surface.
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
 * Reads the active tab's URL. Returns `null` for anything that is not a web
 * page, so a pin can never be satisfied by `about:` or an extension page.
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
    // Thrown when the permission is absent, which is the ordinary state.
    return null;
  }
}

/**
 * Watches the active tab's URL.
 *
 * Four signals are needed: switching tabs, the open tab navigating (including
 * the history API, which is how a YouTube video changes), moving between
 * windows, and the permission being granted or revoked.
 *
 * Safe outside an extension context, where it reports "not granted" once.
 */
export function subscribeToActiveUrl(listener: (state: ActiveUrlState) => void): () => void {
  const api = getBrowserApi();
  if (!api) {
    listener({ url: null, granted: false });
    return () => undefined;
  }

  let cancelled = false;
  // Guards against an earlier query settling last and reporting a stale URL.
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

  // Only a URL change matters. Title and favicon updates would re-run this
  // several times per page load for the same answer.
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
