import type { PendingWrite } from '../../src/services/teardown';
import { logError } from '../../src/services/errors';
import { FLUSH_PENDING, type FlushPendingMessage } from './messages';

/**
 * Gives the save queue to the service worker while the document is being
 * destroyed.
 *
 * `sendMessage` hands the payload to the browser process synchronously, so
 * delivery stops depending on this page a moment later — which is the entire
 * point. Everything after that (waking the worker, opening IndexedDB, writing)
 * happens somewhere that is not about to be collected.
 *
 * Installed by `entry.tsx` for both Chrome surfaces. The popup needs it because
 * Chrome tears it down the instant it loses focus; the full-page tab gets it too
 * because a closing tab is the same hazard in slower motion, and there is no
 * reason to be less careful there.
 */
export function handOffToServiceWorker(writes: readonly PendingWrite[]): void {
  // `typeof` rather than a truthiness check: outside an extension the identifier
  // is undeclared, not merely undefined, so reading it directly throws.
  if (typeof chrome === 'undefined' || !chrome) return;

  const message: FlushPendingMessage = { type: FLUSH_PENDING, writes: [...writes] };
  try {
    // The reply is ignored, and usually never arrives: by the time the worker
    // answers there is nothing here to receive it. Both outcomes are handled so
    // the rejection never surfaces as an unhandled promise.
    void chrome.runtime.sendMessage(message).then(
      () => undefined,
      () => undefined,
    );
  } catch (error) {
    // Nothing left to recover with — but a synchronous throw here would abort
    // the rest of the teardown handlers, so it stops at this boundary.
    logError('teardownHandoff', error);
  }
}
