import type { NotePatch } from '../types';

/**
 * Escape hatch for surfaces that can be destroyed without warning.
 *
 * A Firefox sidebar and a browser tab both get to finish an `await` after
 * `pagehide`, so autosave can simply write on the way out. A Chrome toolbar
 * popup does not: the moment it loses focus its document is torn down, and an
 * IndexedDB transaction opened microseconds earlier dies with the connection
 * that owns it. Starting a write there is not slow, it is *unreliable*, which is
 * the worst property a save path can have.
 *
 * So the Chrome build installs a handoff: on teardown the queued patches are
 * taken out of the save queue and posted to the extension's service worker,
 * which has its own lifetime and its own connection to the same database. The
 * work is done by something that will still exist a moment later.
 *
 * The seam is a plain function so that `src/` needs no knowledge of Chrome, no
 * build-time flag, and no branch that unit tests cannot reach. Nothing installs
 * a handoff by default; Firefox never does, and keeps flushing in place.
 */

/** One queued-but-unwritten patch, with the version it was queued against. */
export interface PendingWrite {
  noteId: string;
  patch: NotePatch;
  /** `updatedAt` this session last observed, for optimistic concurrency. */
  expectedUpdatedAt: number | null;
}

export type TeardownHandoff = (writes: readonly PendingWrite[]) => void;

let handoff: TeardownHandoff | null = null;

/**
 * Registers the handoff. Call before mounting the app; passing `null` restores
 * the default in-page flush.
 */
export function setTeardownHandoff(next: TeardownHandoff | null): void {
  handoff = next;
}

export function getTeardownHandoff(): TeardownHandoff | null {
  return handoff;
}
