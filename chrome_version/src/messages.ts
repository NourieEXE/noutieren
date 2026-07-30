import type { NotePatch } from '../../src/types';
import type { PendingWrite } from '../../src/services/teardown';
import { isValidId } from '../../src/utils/id';

/**
 * The one message this extension sends: a dying popup handing its unwritten
 * patches to the service worker.
 *
 * Both ends live in this build, so the wire format is an implementation detail
 * rather than an API. It is still parsed rather than trusted, for two reasons:
 * an extension is reloaded far more often than it is rebuilt, so a worker from
 * one version can briefly receive a message from a page of another; and this
 * data goes straight into IndexedDB, which is the last place to discover that a
 * field was not the shape it claimed.
 */

export const FLUSH_PENDING = 'noutieren/flush-pending';

export interface FlushPendingMessage {
  type: typeof FLUSH_PENDING;
  writes: PendingWrite[];
}

export interface FlushPendingResult {
  written: number;
  failed: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Copies across only the fields a patch may carry, each only if it holds the
 * type it is supposed to.
 *
 * `applyNotePatch` writes `plainText`, `tabId` and `position` through to storage
 * untouched, so a wrong type here would become a corrupt row — a string
 * `position` is enough to scramble the order of a tab. Titles and colours are
 * normalized downstream, so a type check is all they need here.
 */
function sanitizePatch(source: Record<string, unknown>): NotePatch {
  const patch: NotePatch = {};
  if (typeof source.title === 'string') patch.title = source.title;
  if (typeof source.color === 'string') patch.color = source.color;
  if (typeof source.plainText === 'string') patch.plainText = source.plainText;
  if (isValidId(source.tabId)) patch.tabId = source.tabId;
  if (typeof source.position === 'number' && Number.isFinite(source.position)) {
    patch.position = source.position;
  }
  // The document body is taken as-is once it is an object at all. It came from
  // this extension's own editor and is stored verbatim either way;
  // `editor/sanitize` is for documents of unknown provenance, which this is not.
  if (isRecord(source.content)) patch.content = source.content;
  return patch;
}

/**
 * Validates an incoming message.
 *
 * Returns `null` when this is not a flush message at all — which the listener
 * must distinguish from an empty one, so it can decline to answer messages that
 * are none of its business. Individual malformed entries are dropped rather than
 * failing the batch: losing one note's last keystrokes beats losing every
 * note's.
 */
export function parseFlushPending(message: unknown): PendingWrite[] | null {
  if (!isRecord(message) || message.type !== FLUSH_PENDING) return null;
  if (!Array.isArray(message.writes)) return null;

  const writes: PendingWrite[] = [];
  for (const entry of message.writes) {
    if (!isRecord(entry)) continue;
    if (!isValidId(entry.noteId)) continue;
    if (!isRecord(entry.patch)) continue;

    const patch = sanitizePatch(entry.patch);
    // Nothing survived validation. Writing it would bump `updatedAt` and make a
    // note look edited without changing anything about it.
    if (Object.keys(patch).length === 0) continue;

    writes.push({
      noteId: entry.noteId,
      patch,
      // A missing or malformed base version becomes `null`, which
      // `applyNotePatch` reads as "do not check" — correct here, because the
      // page that could have resolved a conflict no longer exists.
      expectedUpdatedAt:
        typeof entry.expectedUpdatedAt === 'number' && Number.isFinite(entry.expectedUpdatedAt)
          ? entry.expectedUpdatedAt
          : null,
    });
  }
  return writes;
}
