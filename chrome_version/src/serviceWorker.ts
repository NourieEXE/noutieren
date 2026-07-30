import type * as WebExtension from 'webextension-polyfill';
import { applyNotePatch } from '../../src/database/notesRepository';
import { logError } from '../../src/services/errors';
import type { PendingWrite } from '../../src/services/teardown';
import { parseFlushPending, type FlushPendingResult } from './messages';

/**
 * Chrome MV3 service worker.
 *
 * It exists for one reason: to finish writes a popup could not. Chrome destroys
 * a popup's document the moment it loses focus, taking any open IndexedDB
 * transaction with it, so the popup hands its queue here on the way out and this
 * worker — a separate context with its own connection to the same database —
 * performs the write.
 *
 * There is no toolbar-click listener, unlike the Firefox build: `default_popup`
 * in the manifest means Chrome opens the popup itself.
 */

/**
 * Writes handed-off patches, one note at a time.
 *
 * Exported so the behaviour can be tested without a `chrome` global.
 *
 * Each write keeps the base version the popup queued it against, so a genuinely
 * concurrent edit in another window is still detected. A conflict here is simply
 * counted: the page that could have offered a choice is gone, and the newer data
 * already in storage is the better answer. Notes are independent, so one failure
 * never stops the rest.
 */
export async function applyHandedOffWrites(
  writes: readonly PendingWrite[],
): Promise<FlushPendingResult> {
  let written = 0;
  let failed = 0;

  for (const write of writes) {
    try {
      const result = await applyNotePatch(write.noteId, write.patch, {
        expectedUpdatedAt: write.expectedUpdatedAt,
      });
      if (result.status === 'saved') written += 1;
      else failed += 1;
    } catch (error) {
      logError('serviceWorker.flushPending', error);
      failed += 1;
    }
  }

  return { written, failed };
}

/**
 * The real contract for a three-argument message listener: return `true` to
 * claim the message and reply later, or nothing to decline it.
 *
 * `webextension-polyfill` types only the claiming half — its
 * `OnMessageListenerCallback` returns exactly `true` — so declining needs a cast
 * at the registration site below. This alias is the signature that is actually
 * being honoured, which is why the handler is written against it rather than
 * against the library type.
 */
type MessageHandler = (
  message: unknown,
  sender: WebExtension.Runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => true | undefined;

const handleMessage: MessageHandler = (message, _sender, sendResponse) => {
  const writes = parseFlushPending(message);
  // Not ours: claim nothing, so any other listener stays free to answer.
  if (writes === null) return undefined;

  void applyHandedOffWrites(writes).then((result) => {
    try {
      sendResponse(result);
    } catch {
      // The popup that asked has almost certainly gone; the write is what
      // mattered, and it has already happened.
    }
  });

  // Keeps the worker alive until `sendResponse` runs.
  return true;
};

// `typeof` rather than a truthiness check: outside an extension the identifier
// is undeclared, not merely undefined, so reading it directly throws. Unit tests
// import this module for `applyHandedOffWrites` and must not trip over the
// registration on the way in.
if (typeof chrome !== 'undefined' && chrome) {
  chrome.runtime.onMessage.addListener(
    handleMessage as WebExtension.Runtime.OnMessageListenerCallback,
  );
}
