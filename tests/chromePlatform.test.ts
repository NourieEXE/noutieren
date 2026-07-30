import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, resetDatabase } from './helpers';
import { SaveQueue } from '../src/services/saveQueue';
import { detectViewMode, getBrowserApi, isExtensionContext } from '../src/services/webext';
import {
  getTeardownHandoff,
  setTeardownHandoff,
  type PendingWrite,
} from '../src/services/teardown';
import { createTab } from '../src/database/tabsRepository';
import { createNote, getNote, getNoteContent } from '../src/database/notesRepository';
import { FLUSH_PENDING, parseFlushPending } from '../chrome_version/src/messages';
import { applyHandedOffWrites } from '../chrome_version/src/serviceWorker';
import type { Note } from '../src/types';

/**
 * The Chrome port's own surface: namespace detection, popup view detection, and
 * the teardown handoff that keeps autosave reliable in a document Chrome can
 * destroy at any moment.
 */

const DEBOUNCE = 400;

let queue: SaveQueue;

beforeEach(async () => {
  await resetDatabase();
  queue = new SaveQueue({ debounceMs: DEBOUNCE });
});

afterEach(() => {
  queue.destroy();
  setTeardownHandoff(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function seedNote(title: string): Promise<Note> {
  const tab = await createTab({ title: 'Tab' });
  return createNote({ tabId: tab.id, title });
}

describe('browser namespace detection', () => {
  it('has no extension API in a plain test environment', () => {
    expect(getBrowserApi()).toBeNull();
    expect(isExtensionContext()).toBe(false);
  });

  it("falls back to Chrome's namespace when `browser` is absent", () => {
    const api = { runtime: { id: 'abc' } };
    vi.stubGlobal('chrome', api);

    expect(getBrowserApi()).toBe(api);
    expect(isExtensionContext()).toBe(true);
  });

  it('prefers `browser` when both namespaces exist', () => {
    // Firefox exposes a callback-based `chrome` alongside its promise-based
    // `browser`, so the order matters there: picking `chrome` would hand back an
    // API whose methods take callbacks and return undefined, and every `await`
    // in this codebase would quietly resolve to nothing.
    const promiseBased = { runtime: { id: 'gecko' } };
    vi.stubGlobal('browser', promiseBased);
    vi.stubGlobal('chrome', { runtime: { id: 'gecko' } });

    expect(getBrowserApi()).toBe(promiseBased);
  });

  it('ignores the `chrome` object that ordinary web pages carry', () => {
    // Chrome exposes an unrelated `chrome` global to every page. Treating it as
    // the extension API would make preference writes vanish silently, since the
    // code would stop using its localStorage fallback.
    vi.stubGlobal('chrome', { loadTimes: () => undefined });

    expect(getBrowserApi()).toBeNull();
    expect(isExtensionContext()).toBe(false);
  });
});

describe('view mode detection', () => {
  it('reads an explicit view from the query string', () => {
    expect(detectViewMode('?view=page', '/index.html')).toBe('page');
    expect(detectViewMode('?view=sidebar', '/index.html')).toBe('sidebar');
    expect(detectViewMode('?view=popup', '/index.html')).toBe('popup');
  });

  it("infers the popup from Chrome's popup document", () => {
    // `action.default_popup` takes a plain path, so the filename is the signal.
    expect(detectViewMode('', '/popup.html')).toBe('popup');
    expect(detectViewMode('', 'popup.html')).toBe('popup');
  });

  it('falls back to the sidebar for anything else', () => {
    expect(detectViewMode('', '/index.html')).toBe('sidebar');
    expect(detectViewMode('?view=nonsense', '/index.html')).toBe('sidebar');
    // Matching a bare filename suffix, not a substring: neither of these is the
    // popup document.
    expect(detectViewMode('', '/notpopup.html')).toBe('sidebar');
    expect(detectViewMode('?note=popup.html', '/index.html')).toBe('sidebar');
  });
});

describe('teardown handoff registration', () => {
  it('installs nothing by default, so Firefox keeps flushing in place', () => {
    expect(getTeardownHandoff()).toBeNull();
  });

  it('round-trips a handoff and clears it again', () => {
    const handoff = vi.fn();
    setTeardownHandoff(handoff);
    expect(getTeardownHandoff()).toBe(handoff);

    setTeardownHandoff(null);
    expect(getTeardownHandoff()).toBeNull();
  });
});

describe('takePendingSnapshot', () => {
  it('returns queued patches with the version they were queued against', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);

    queue.schedule(note.id, { content: doc('typed'), plainText: 'typed' });
    const writes = queue.takePendingSnapshot();

    expect(writes).toHaveLength(1);
    expect(writes[0].noteId).toBe(note.id);
    expect(writes[0].expectedUpdatedAt).toBe(note.updatedAt);
    expect(writes[0].patch.plainText).toBe('typed');
  });

  it('cancels the debounce timer, so nothing is written twice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);

    queue.schedule(note.id, { content: doc('typed'), plainText: 'typed' });
    queue.takePendingSnapshot();

    // Well past the window the cancelled timer would have fired in.
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);

    expect(queue.hasPending(note.id)).toBe(false);
    // The queue gave the patch away; it must not also have stored it.
    expect(await getNoteContent(note.id)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it('empties the queue, so a second teardown event hands off nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const note = await seedNote('Note');
    queue.schedule(note.id, { plainText: 'typed' });

    expect(queue.takePendingSnapshot()).toHaveLength(1);
    // `pagehide` and `beforeunload` both fire; only the first may claim the work.
    expect(queue.takePendingSnapshot()).toEqual([]);
  });

  it('keeps every note separate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tab = await createTab({ title: 'Tab' });
    const a = await createNote({ tabId: tab.id, title: 'A' });
    const b = await createNote({ tabId: tab.id, title: 'B' });

    queue.schedule(a.id, { plainText: 'a text' });
    queue.schedule(b.id, { plainText: 'b text' });

    const writes = queue.takePendingSnapshot();
    const byId = new Map(writes.map((write) => [write.noteId, write.patch.plainText]));
    expect(byId.get(a.id)).toBe('a text');
    expect(byId.get(b.id)).toBe('b text');
  });
});

describe('flush message', () => {
  it('parses a well-formed handoff', () => {
    const writes: PendingWrite[] = [
      { noteId: 'a1b2c3', patch: { plainText: 'text' }, expectedUpdatedAt: 42 },
    ];
    expect(parseFlushPending({ type: FLUSH_PENDING, writes })).toEqual(writes);
  });

  it('declines messages that are not a handoff', () => {
    // `null` means "not mine", which the worker must not confuse with an empty
    // batch — one declines the message, the other answers it.
    expect(parseFlushPending({ type: 'something/else', writes: [] })).toBeNull();
    expect(parseFlushPending(undefined)).toBeNull();
    expect(parseFlushPending('flush')).toBeNull();
    expect(parseFlushPending({ type: FLUSH_PENDING })).toBeNull();
    expect(parseFlushPending({ type: FLUSH_PENDING, writes: 'nope' })).toBeNull();
  });

  it('drops malformed entries but keeps the rest of the batch', () => {
    const parsed = parseFlushPending({
      type: FLUSH_PENDING,
      writes: [
        { noteId: 'good-id', patch: { plainText: 'keep' }, expectedUpdatedAt: 1 },
        { noteId: '', patch: { plainText: 'no id' }, expectedUpdatedAt: 1 },
        { noteId: 'no-patch', expectedUpdatedAt: 1 },
        null,
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].noteId).toBe('good-id');
  });

  it('treats an unusable base version as no version check', () => {
    const parsed = parseFlushPending({
      type: FLUSH_PENDING,
      writes: [
        { noteId: 'a', patch: { plainText: 'a' }, expectedUpdatedAt: 'soon' },
        { noteId: 'b', patch: { plainText: 'b' }, expectedUpdatedAt: Number.NaN },
        { noteId: 'c', patch: { plainText: 'c' } },
      ],
    });

    expect(parsed?.map((write) => write.expectedUpdatedAt)).toEqual([null, null, null]);
  });

  it('keeps only known patch fields that hold the right type', () => {
    const parsed = parseFlushPending({
      type: FLUSH_PENDING,
      writes: [
        {
          noteId: 'note',
          patch: {
            title: 'Kept',
            plainText: 'kept',
            position: 3,
            // `applyNotePatch` writes these straight through, so a wrong type
            // would become a corrupt row rather than a rejected message.
            tabId: { not: 'an id' },
            unknownField: 'dropped',
          },
          expectedUpdatedAt: 1,
        },
      ],
    });

    expect(parsed?.[0].patch).toEqual({ title: 'Kept', plainText: 'kept', position: 3 });
  });

  it('drops an entry whose patch has nothing usable left', () => {
    // Writing it would bump `updatedAt` and make the note look edited.
    const parsed = parseFlushPending({
      type: FLUSH_PENDING,
      writes: [
        { noteId: 'empty', patch: {}, expectedUpdatedAt: 1 },
        { noteId: 'junk', patch: { position: 'third' }, expectedUpdatedAt: 1 },
      ],
    });

    expect(parsed).toEqual([]);
  });
});

describe('applying handed-off writes', () => {
  it('persists a patch the popup never got to write', async () => {
    const note = await seedNote('Note');

    const result = await applyHandedOffWrites([
      {
        noteId: note.id,
        patch: { content: doc('last keystrokes'), plainText: 'last keystrokes' },
        expectedUpdatedAt: note.updatedAt,
      },
    ]);

    expect(result).toEqual({ written: 1, failed: 0 });
    expect(await getNoteContent(note.id)).toEqual(doc('last keystrokes'));
    expect((await getNote(note.id))?.plainText).toBe('last keystrokes');
  });

  it('refuses a stale write, leaving a concurrent edit intact', async () => {
    const note = await seedNote('Note');
    // Another window saved after this patch was queued.
    const { applyNotePatch } = await import('../src/database/notesRepository');
    await applyNotePatch(note.id, { plainText: 'from the other window' });

    const result = await applyHandedOffWrites([
      { noteId: note.id, patch: { plainText: 'stale' }, expectedUpdatedAt: note.updatedAt },
    ]);

    expect(result).toEqual({ written: 0, failed: 1 });
    expect((await getNote(note.id))?.plainText).toBe('from the other window');
  });

  it('counts a deleted note as failed rather than throwing', async () => {
    const result = await applyHandedOffWrites([
      { noteId: 'deleted-note', patch: { plainText: 'gone' }, expectedUpdatedAt: null },
    ]);

    expect(result).toEqual({ written: 0, failed: 1 });
  });

  it('writes the remaining notes when one of them fails', async () => {
    const tab = await createTab({ title: 'Tab' });
    const note = await createNote({ tabId: tab.id, title: 'Survivor' });

    const result = await applyHandedOffWrites([
      { noteId: 'missing', patch: { plainText: 'lost' }, expectedUpdatedAt: null },
      { noteId: note.id, patch: { plainText: 'saved anyway' }, expectedUpdatedAt: null },
    ]);

    expect(result).toEqual({ written: 1, failed: 1 });
    expect((await getNote(note.id))?.plainText).toBe('saved anyway');
  });

  it('handles an empty batch', async () => {
    expect(await applyHandedOffWrites([])).toEqual({ written: 0, failed: 0 });
  });
});
