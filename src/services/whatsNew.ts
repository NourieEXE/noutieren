/**
 * The one-time "Updated to x.y.z" line. The background notes the update, since
 * only it hears about one, and the next view shows the line until it is
 * dismissed or "What's new" is opened. A fresh install shows nothing.
 */

import type * as WebExtension from 'webextension-polyfill';
import { getBrowserApi, type BrowserApi } from './webext';
import { logError } from './errors';

/** The version updated from. Separate from `preferences`, which views rewrite whole. */
const KEY = 'updatedFrom';

export async function recordUpdate(
  api: BrowserApi,
  details: WebExtension.Runtime.OnInstalledDetailsType,
): Promise<void> {
  const from = details.previousVersion;
  if (details.reason !== 'update' || !from) return;
  // Reloading an unpacked build reports an update to the same version.
  if (from === api.runtime.getManifest().version) return;
  // Keep the oldest unseen version if several updates land before anyone looks.
  const stored = await api.storage.local.get(KEY);
  if (typeof stored[KEY] === 'string') return;
  await api.storage.local.set({ [KEY]: from });
}

export function installUpdateNotice(api: BrowserApi): void {
  api.runtime.onInstalled.addListener((details) => {
    void recordUpdate(api, details).catch((error: unknown) => logError('recordUpdate', error));
  });
}

/** Whether there is an update the user has not been told about. */
export function subscribeToPendingUpdate(listener: (pending: boolean) => void): () => void {
  const api = getBrowserApi();
  if (!api) return () => undefined;

  let cancelled = false;
  void api.storage.local
    .get(KEY)
    .then((stored) => {
      if (!cancelled) listener(typeof stored[KEY] === 'string');
    })
    .catch((error: unknown) => logError('readPendingUpdate', error));

  // Dismissed in another view: hide it here too.
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && KEY in changes) listener(typeof changes[KEY].newValue === 'string');
  };
  api.storage.onChanged?.addListener(onChanged);
  return () => {
    cancelled = true;
    api.storage.onChanged?.removeListener(onChanged);
  };
}

export async function clearPendingUpdate(): Promise<void> {
  await getBrowserApi()?.storage.local.remove(KEY);
}

/** The installed version, or `null` outside an extension. */
export function installedVersion(): string | null {
  return getBrowserApi()?.runtime.getManifest().version ?? null;
}
