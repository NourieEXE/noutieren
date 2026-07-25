import type { NotePatch, SaveState } from '../types';
import { applyNotePatch } from '../database/notesRepository';
import { describeError, logError } from './errors';

/**
 * Debounced autosave.
 *
 * Correctness rules this class exists to enforce:
 *
 * - Every pending patch is stored **under its own note id**, so a debounce
 *   callback fired after the user switched notes can only ever write to the
 *   note the text was typed into.
 * - Writes for one note are chained, so an earlier save can never land after a
 *   later one and resurrect stale text.
 * - `flush()` cancels the pending timer and writes immediately; it is called on
 *   note switch, blur, tab hide, unload, unmount and Ctrl/Cmd+S.
 * - A failed write puts the patch back in the queue instead of dropping it, and
 *   surfaces an error state.
 * - Each note carries a base version (its `updatedAt` when this session read
 *   it). If another view wrote in the meantime the save is refused as a
 *   conflict rather than silently overwriting.
 */

/** Within the 300–500 ms window the product spec asks for. */
export const DEFAULT_DEBOUNCE_MS = 400;

/** How long "Saved" stays visible before the indicator goes quiet. */
export const SAVED_INDICATOR_MS = 1500;

export interface SaveQueueStatus {
  state: SaveState;
  pendingNoteIds: readonly string[];
  errorMessage: string | null;
}

export interface SaveConflict {
  noteId: string;
  currentUpdatedAt: number;
}

export type ConflictResolution = 'keep-mine' | 'use-theirs';

interface PendingEntry {
  patch: NotePatch;
  timer: ReturnType<typeof setTimeout> | null;
}

const IDLE_STATUS: SaveQueueStatus = { state: 'idle', pendingNoteIds: [], errorMessage: null };

export class SaveQueue {
  private readonly debounceMs: number;
  private readonly pending = new Map<string, PendingEntry>();
  /** Serialises writes per note id. */
  private readonly writeChains = new Map<string, Promise<void>>();
  /** `updatedAt` this session last observed for each note. */
  private readonly baseVersions = new Map<string, number | null>();
  /** Patches refused because another view had newer data. */
  private readonly conflicts = new Map<string, NotePatch>();

  private readonly statusListeners = new Set<(status: SaveQueueStatus) => void>();
  private readonly conflictListeners = new Set<(conflict: SaveConflict) => void>();

  private status: SaveQueueStatus = IDLE_STATUS;
  private errorMessage: string | null = null;
  private justSaved = false;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { debounceMs?: number } = {}) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Records the version an editing session started from. Called when a note's
   * document is loaded, and again after every successful write.
   */
  setBaseVersion(noteId: string, updatedAt: number | null): void {
    this.baseVersions.set(noteId, updatedAt);
  }

  getBaseVersion(noteId: string): number | null {
    return this.baseVersions.get(noteId) ?? null;
  }

  /** Queues a patch for `noteId`, restarting that note's debounce window. */
  schedule(noteId: string, patch: NotePatch): void {
    const existing = this.pending.get(noteId);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      this.dispatch(noteId);
    }, this.debounceMs);

    this.pending.set(noteId, { patch: { ...existing?.patch, ...patch }, timer });
    this.justSaved = false;
    this.emit();
  }

  hasPending(noteId?: string): boolean {
    if (noteId) return this.pending.has(noteId) || this.writeChains.has(noteId);
    return this.pending.size > 0 || this.writeChains.size > 0;
  }

  /** The queued-but-unwritten patch for a note. Exposed for tests. */
  peekPending(noteId: string): NotePatch | undefined {
    return this.pending.get(noteId)?.patch;
  }

  /**
   * Writes pending changes immediately and resolves once the storage write has
   * settled. Without arguments it flushes every note.
   */
  async flush(noteId?: string): Promise<void> {
    const ids =
      noteId !== undefined
        ? [noteId]
        : [...new Set([...this.pending.keys(), ...this.writeChains.keys()])];

    for (const id of ids) this.dispatch(id);
    await Promise.all(ids.map((id) => this.writeChains.get(id) ?? Promise.resolve()));
  }

  /**
   * Resolves a conflict reported through `onConflict`.
   *
   * `keep-mine` force-writes the refused patch; `use-theirs` drops it and
   * clears the base version so the caller reloads the stored document.
   */
  async resolveConflict(noteId: string, resolution: ConflictResolution): Promise<void> {
    const patch = this.conflicts.get(noteId);
    this.conflicts.delete(noteId);
    this.errorMessage = null;

    if (resolution === 'keep-mine' && patch) {
      try {
        const result = await applyNotePatch(noteId, patch, { force: true });
        if (result.status === 'saved') {
          this.baseVersions.set(noteId, result.updatedAt);
          this.markSaved();
        }
      } catch (error) {
        logError('saveQueue.resolveConflict', error);
        this.errorMessage = describeError(error);
      }
    } else {
      this.baseVersions.delete(noteId);
    }
    this.emit();
  }

  hasConflict(noteId: string): boolean {
    return this.conflicts.has(noteId);
  }

  /** Drops queued work for a deleted note. */
  discard(noteId: string): void {
    const existing = this.pending.get(noteId);
    if (existing?.timer) clearTimeout(existing.timer);
    this.pending.delete(noteId);
    this.conflicts.delete(noteId);
    this.baseVersions.delete(noteId);
    this.emit();
  }

  getStatus(): SaveQueueStatus {
    return this.status;
  }

  subscribe(listener: (status: SaveQueueStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onConflict(listener: (conflict: SaveConflict) => void): () => void {
    this.conflictListeners.add(listener);
    return () => {
      this.conflictListeners.delete(listener);
    };
  }

  /** Clears timers. Called when the app unmounts. */
  destroy(): void {
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.pending.clear();
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = null;
    this.statusListeners.clear();
    this.conflictListeners.clear();
  }

  /** Moves a note's pending patch into its write chain, cancelling the timer. */
  private dispatch(noteId: string): void {
    const entry = this.pending.get(noteId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(noteId);

    const previous = this.writeChains.get(noteId) ?? Promise.resolve();
    const chain = previous.then(() => this.write(noteId, entry.patch));
    this.writeChains.set(noteId, chain);

    void chain.then(() => {
      // Only the newest chain for this note clears the entry.
      if (this.writeChains.get(noteId) === chain) {
        this.writeChains.delete(noteId);
        this.emit();
      }
    });
    this.emit();
  }

  /** Performs one write. Never rejects, so the chain always continues. */
  private async write(noteId: string, patch: NotePatch): Promise<void> {
    try {
      const result = await applyNotePatch(noteId, patch, {
        expectedUpdatedAt: this.baseVersions.get(noteId) ?? null,
      });

      if (result.status === 'saved') {
        this.baseVersions.set(noteId, result.updatedAt);
        this.errorMessage = null;
        this.markSaved();
      } else if (result.status === 'conflict') {
        // Hold the text so the user can still choose to keep it.
        this.conflicts.set(noteId, { ...this.conflicts.get(noteId), ...patch });
        this.errorMessage = 'This note was changed in another view.';
        for (const listener of this.conflictListeners) {
          listener({ noteId, currentUpdatedAt: result.currentUpdatedAt });
        }
      }
      // 'missing' means the note was deleted — dropping the patch is correct.
    } catch (error) {
      logError('saveQueue.write', error);
      // Put the text back. A newer queued patch for the same fields wins, and
      // no timer is re-armed: the retry rides along with the next edit or an
      // explicit flush, so a failing store cannot spin.
      const existing = this.pending.get(noteId);
      this.pending.set(noteId, {
        patch: { ...patch, ...existing?.patch },
        timer: existing?.timer ?? null,
      });
      this.errorMessage = describeError(error);
    } finally {
      this.emit();
    }
  }

  private markSaved(): void {
    this.justSaved = true;
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => {
      this.justSaved = false;
      this.savedTimer = null;
      this.emit();
    }, SAVED_INDICATOR_MS);
  }

  private computeState(): SaveState {
    if (this.errorMessage) return 'error';
    if (this.pending.size > 0 || this.writeChains.size > 0) return 'saving';
    if (this.justSaved) return 'saved';
    return 'idle';
  }

  /**
   * Publishes status, reusing the previous object when nothing changed so
   * `useSyncExternalStore` consumers do not re-render needlessly.
   */
  private emit(): void {
    const pendingNoteIds = [
      ...new Set([...this.pending.keys(), ...this.writeChains.keys()]),
    ].sort();
    const next: SaveQueueStatus = {
      state: this.computeState(),
      pendingNoteIds,
      errorMessage: this.errorMessage,
    };

    const previous = this.status;
    const unchanged =
      previous.state === next.state &&
      previous.errorMessage === next.errorMessage &&
      previous.pendingNoteIds.length === next.pendingNoteIds.length &&
      previous.pendingNoteIds.every((id, index) => id === next.pendingNoteIds[index]);
    if (unchanged) return;

    this.status = next;
    for (const listener of this.statusListeners) listener(next);
  }
}

/** The queue used by the application. */
export const saveQueue = new SaveQueue();
