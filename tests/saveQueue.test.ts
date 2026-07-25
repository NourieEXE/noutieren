import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, resetDatabase } from './helpers';
import { SaveQueue } from '../src/services/saveQueue';
import { createTab } from '../src/database/tabsRepository';
import {
  applyNotePatch,
  createNote,
  deleteNote,
  getNote,
  getNoteContent,
} from '../src/database/notesRepository';
import type { Note } from '../src/types';

const DEBOUNCE = 400;

let queue: SaveQueue;

beforeEach(async () => {
  await resetDatabase();
  queue = new SaveQueue({ debounceMs: DEBOUNCE });
});

afterEach(() => {
  queue.destroy();
  vi.useRealTimers();
});

/** Fake only the timer functions; fake-indexeddb needs the real microtask queue. */
function useTimerMocks() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

async function seedNote(title: string): Promise<Note> {
  const tab = await createTab({ title: 'Tab' });
  return createNote({ tabId: tab.id, title });
}

async function seedTwoNotes(): Promise<[Note, Note]> {
  const tab = await createTab({ title: 'Tab' });
  const a = await createNote({ tabId: tab.id, title: 'A' });
  const b = await createNote({ tabId: tab.id, title: 'B' });
  return [a, b];
}

describe('debouncing', () => {
  it('does not write before the debounce window elapses', async () => {
    useTimerMocks();
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);

    queue.schedule(note.id, { content: doc('typed'), plainText: 'typed' });

    await vi.advanceTimersByTimeAsync(DEBOUNCE - 50);
    // Still the empty document the note was created with.
    expect(await getNoteContent(note.id)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    expect(queue.hasPending(note.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(await getNoteContent(note.id)).toEqual(doc('typed'));
    expect(queue.hasPending(note.id)).toBe(false);
  });

  it('coalesces rapid keystrokes into a single write', async () => {
    useTimerMocks();
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);

    for (const text of ['a', 'ab', 'abc', 'abcd']) {
      queue.schedule(note.id, { content: doc(text), plainText: text });
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(await getNoteContent(note.id)).toEqual(doc('abcd'));
    // One write means one version bump beyond the create.
    const stored = await getNote(note.id);
    expect(stored!.plainText).toBe('abcd');
  });

  it('cancels an obsolete debounce callback when a newer patch arrives', async () => {
    useTimerMocks();
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);

    queue.schedule(note.id, { title: 'first' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 20);
    queue.schedule(note.id, { title: 'second' });
    // The first timer would have fired here had it not been cleared.
    await vi.advanceTimersByTimeAsync(30);
    expect((await getNote(note.id))!.title).toBe('Note');

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect((await getNote(note.id))!.title).toBe('second');
  });
});

describe('flushing', () => {
  it('writes immediately and cancels the pending timer', async () => {
    useTimerMocks();
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);

    queue.schedule(note.id, { content: doc('flushed'), plainText: 'flushed' });
    await queue.flush(note.id);

    expect(await getNoteContent(note.id)).toEqual(doc('flushed'));
    expect(queue.hasPending()).toBe(false);

    // Nothing further happens when the cancelled timer's moment arrives.
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    expect((await getNote(note.id))!.plainText).toBe('flushed');
  });

  it('flushes every pending note when called without an id', async () => {
    const [a, b] = await seedTwoNotes();
    queue.setBaseVersion(a.id, a.updatedAt);
    queue.setBaseVersion(b.id, b.updatedAt);

    queue.schedule(a.id, { content: doc('a text'), plainText: 'a text' });
    queue.schedule(b.id, { content: doc('b text'), plainText: 'b text' });
    await queue.flush();

    expect(await getNoteContent(a.id)).toEqual(doc('a text'));
    expect(await getNoteContent(b.id)).toEqual(doc('b text'));
  });

  it('is harmless when there is nothing to flush', async () => {
    await expect(queue.flush()).resolves.toBeUndefined();
    await expect(queue.flush('unknown-note')).resolves.toBeUndefined();
  });
});

describe('note isolation', () => {
  /** The scenario named in the specification. */
  it('keeps content correct when typing in A, switching to B, typing, and returning to A', async () => {
    const [a, b] = await seedTwoNotes();
    queue.setBaseVersion(a.id, a.updatedAt);
    queue.setBaseVersion(b.id, b.updatedAt);

    // 1. Type in note A.
    queue.schedule(a.id, { content: doc('A first'), plainText: 'A first' });
    // 2. Immediately select note B — the provider flushes the note being left.
    await queue.flush(a.id);
    // 3. Type in note B.
    queue.schedule(b.id, { content: doc('B typing'), plainText: 'B typing' });
    await queue.flush(b.id);
    // 4. Return to A and type again.
    queue.schedule(a.id, { content: doc('A second'), plainText: 'A second' });
    await queue.flush(a.id);

    expect(await getNoteContent(a.id)).toEqual(doc('A second'));
    expect(await getNoteContent(b.id)).toEqual(doc('B typing'));
    expect((await getNote(a.id))!.plainText).toBe('A second');
    expect((await getNote(b.id))!.plainText).toBe('B typing');
    expect((await getNote(a.id))!.title).toBe('A');
    expect((await getNote(b.id))!.title).toBe('B');
  });

  it('never writes one note’s text into another when debounces overlap without flushing', async () => {
    useTimerMocks();
    const [a, b] = await seedTwoNotes();
    queue.setBaseVersion(a.id, a.updatedAt);
    queue.setBaseVersion(b.id, b.updatedAt);

    // Interleave edits so both notes have work in flight at the same time.
    queue.schedule(a.id, { content: doc('A1'), plainText: 'A1' });
    await vi.advanceTimersByTimeAsync(100);
    queue.schedule(b.id, { content: doc('B1'), plainText: 'B1' });
    await vi.advanceTimersByTimeAsync(100);
    queue.schedule(a.id, { content: doc('A2'), plainText: 'A2' });
    await vi.advanceTimersByTimeAsync(100);
    queue.schedule(b.id, { content: doc('B2'), plainText: 'B2' });

    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);

    expect(await getNoteContent(a.id)).toEqual(doc('A2'));
    expect(await getNoteContent(b.id)).toEqual(doc('B2'));
  });

  it('applies a patch to the right note even when the selection changed first', async () => {
    const [a, b] = await seedTwoNotes();
    queue.setBaseVersion(a.id, a.updatedAt);
    queue.setBaseVersion(b.id, b.updatedAt);

    // A patch is queued for A while the UI is already showing B.
    queue.schedule(a.id, { content: doc('belongs to A'), plainText: 'belongs to A' });
    queue.schedule(b.id, { content: doc('belongs to B'), plainText: 'belongs to B' });
    await queue.flush();

    expect((await getNote(a.id))!.plainText).toBe('belongs to A');
    expect((await getNote(b.id))!.plainText).toBe('belongs to B');
  });

  it('drops queued work for a note that was deleted', async () => {
    const note = await seedNote('Doomed');
    queue.setBaseVersion(note.id, note.updatedAt);
    queue.schedule(note.id, { content: doc('never stored'), plainText: 'never stored' });

    await deleteNote(note.id);
    // The write reports the row as missing rather than throwing or recreating it.
    await expect(queue.flush(note.id)).resolves.toBeUndefined();
    expect(await getNote(note.id)).toBeUndefined();
    expect(queue.getStatus().state).not.toBe('error');
  });

  it('forgets pending work and versions on discard', async () => {
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);
    queue.schedule(note.id, { title: 'not saved' });

    queue.discard(note.id);

    expect(queue.hasPending(note.id)).toBe(false);
    expect(queue.getBaseVersion(note.id)).toBeNull();
    await queue.flush();
    expect((await getNote(note.id))!.title).toBe('Note');
  });
});

describe('status reporting', () => {
  it('moves through saving and saved, then goes quiet', async () => {
    useTimerMocks();
    const note = await seedNote('Note');
    queue.setBaseVersion(note.id, note.updatedAt);

    const seen: string[] = [];
    queue.subscribe((status) => seen.push(status.state));

    expect(queue.getStatus().state).toBe('idle');
    queue.schedule(note.id, { title: 'x' });
    expect(queue.getStatus().state).toBe('saving');

    await queue.flush(note.id);
    expect(queue.getStatus().state).toBe('saved');
    expect(queue.getStatus().pendingNoteIds).toEqual([]);

    // The "Saved" badge stops showing after its window.
    await vi.advanceTimersByTimeAsync(2000);
    expect(queue.getStatus().state).toBe('idle');
    expect(seen).toContain('saving');
    expect(seen).toContain('saved');
  });

  it('reuses the status object when nothing changed', () => {
    const first = queue.getStatus();
    expect(queue.getStatus()).toBe(first);
  });

  it('reports which notes have unsaved work', async () => {
    const [a, b] = await seedTwoNotes();
    queue.schedule(a.id, { title: 'a' });
    queue.schedule(b.id, { title: 'b' });
    expect([...queue.getStatus().pendingNoteIds].sort()).toEqual([a.id, b.id].sort());
    await queue.flush();
    expect(queue.getStatus().pendingNoteIds).toEqual([]);
  });
});

describe('conflicts between two open views', () => {
  it('refuses to overwrite and reports the conflict instead', async () => {
    const note = await seedNote('Shared');
    queue.setBaseVersion(note.id, note.updatedAt);

    const conflicts: string[] = [];
    queue.onConflict((conflict) => conflicts.push(conflict.noteId));

    // Another view saves first.
    await applyNotePatch(note.id, { content: doc('other view text') });

    queue.schedule(note.id, { content: doc('my text'), plainText: 'my text' });
    await queue.flush(note.id);

    expect(conflicts).toEqual([note.id]);
    expect(queue.hasConflict(note.id)).toBe(true);
    expect(queue.getStatus().state).toBe('error');
    // Crucially, the other view's text is still there.
    expect(await getNoteContent(note.id)).toEqual(doc('other view text'));
  });

  it('keeps my version when the user chooses to', async () => {
    const note = await seedNote('Shared');
    queue.setBaseVersion(note.id, note.updatedAt);
    await applyNotePatch(note.id, { content: doc('other view text') });

    queue.schedule(note.id, { content: doc('my text'), plainText: 'my text' });
    await queue.flush(note.id);
    await queue.resolveConflict(note.id, 'keep-mine');

    expect(await getNoteContent(note.id)).toEqual(doc('my text'));
    expect(queue.hasConflict(note.id)).toBe(false);
    expect(queue.getStatus().errorMessage).toBeNull();
  });

  it('discards my version when the user chooses the other one', async () => {
    const note = await seedNote('Shared');
    queue.setBaseVersion(note.id, note.updatedAt);
    await applyNotePatch(note.id, { content: doc('other view text') });

    queue.schedule(note.id, { content: doc('my text'), plainText: 'my text' });
    await queue.flush(note.id);
    await queue.resolveConflict(note.id, 'use-theirs');

    expect(await getNoteContent(note.id)).toEqual(doc('other view text'));
    expect(queue.hasConflict(note.id)).toBe(false);
    // The base version is cleared so the caller reloads the stored document.
    expect(queue.getBaseVersion(note.id)).toBeNull();
  });

  it('does not report a conflict for a note this session has not read', async () => {
    const note = await seedNote('Fresh');
    // No base version registered: nothing to conflict with.
    queue.schedule(note.id, { title: 'renamed anyway' });
    await queue.flush(note.id);
    expect(queue.hasConflict(note.id)).toBe(false);
    expect((await getNote(note.id))!.title).toBe('renamed anyway');
  });
});
