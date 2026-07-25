import { beforeEach, describe, expect, it } from 'vitest';
import { doc, resetDatabase } from './helpers';
import { createTab, deleteTab, listTabs } from '../src/database/tabsRepository';
import {
  applyNotePatch,
  countAllNotes,
  createNote,
  deleteNote,
  duplicateNote,
  getFullNote,
  getNote,
  getNoteContent,
  listAllNotesWithContent,
  listNotesByTab,
  moveNoteToTab,
  moveNoteWithinTab,
  noteCountsByTab,
  restoreNote,
} from '../src/database/notesRepository';
import { getDatabase } from '../src/database/db';

beforeEach(async () => {
  await resetDatabase();
});

async function makeTab(title = 'Tab') {
  return createTab({ title });
}

describe('creating notes', () => {
  it('supports many notes in one tab with increasing positions', async () => {
    const tab = await makeTab();
    const created = [];
    for (let i = 0; i < 25; i += 1) {
      created.push(await createNote({ tabId: tab.id, title: `Note ${i}` }));
    }

    const notes = await listNotesByTab(tab.id);
    expect(notes).toHaveLength(25);
    expect(notes.map((note) => note.position)).toEqual([...Array(25).keys()]);
    expect(notes.map((note) => note.title)).toEqual(created.map((note) => note.title));
    expect(new Set(notes.map((note) => note.id)).size).toBe(25);
  });

  it('stores the document separately from the metadata', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id, content: doc('hello world') });

    const meta = await getNote(note.id);
    expect(meta).toBeDefined();
    expect('content' in (meta as object)).toBe(false);
    expect(meta!.plainText).toBe('hello world');
    expect(await getNoteContent(note.id)).toEqual(doc('hello world'));

    const full = await getFullNote(note.id);
    expect(full?.content).toEqual(doc('hello world'));
  });

  it('defaults title, color and content', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id });
    expect(note.title).toBe('New note');
    expect(note.color).toBe('#64748b');
    expect(note.plainText).toBe('');
    expect(await getNoteContent(note.id)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });
});

describe('patching notes', () => {
  it('updates title, color and content in one atomic write', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id });

    const result = await applyNotePatch(note.id, {
      title: 'Renamed',
      color: '#22c55e',
      content: doc('new body'),
    });

    expect(result.status).toBe('saved');
    const meta = await getNote(note.id);
    expect(meta?.title).toBe('Renamed');
    expect(meta?.color).toBe('#22c55e');
    // plainText is derived from the document when not supplied.
    expect(meta?.plainText).toBe('new body');
    expect(await getNoteContent(note.id)).toEqual(doc('new body'));
  });

  it('always moves updatedAt forward, even within one millisecond', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id });

    let previous = note.updatedAt;
    for (let i = 0; i < 5; i += 1) {
      const result = await applyNotePatch(note.id, { title: `T${i}` });
      if (result.status !== 'saved') throw new Error('expected save');
      expect(result.updatedAt).toBeGreaterThan(previous);
      previous = result.updatedAt;
    }
  });

  it('reports a missing note instead of throwing', async () => {
    expect(await applyNotePatch('nope', { title: 'x' })).toEqual({ status: 'missing' });
  });

  it('refuses to overwrite a newer version and can be forced', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id, content: doc('original') });
    const staleVersion = note.updatedAt;

    // Another view writes first.
    const other = await applyNotePatch(note.id, { content: doc('from other view') });
    if (other.status !== 'saved') throw new Error('expected save');

    const conflict = await applyNotePatch(
      note.id,
      { content: doc('from this view') },
      { expectedUpdatedAt: staleVersion },
    );
    expect(conflict).toEqual({ status: 'conflict', currentUpdatedAt: other.updatedAt });
    // Nothing was overwritten.
    expect(await getNoteContent(note.id)).toEqual(doc('from other view'));

    const forced = await applyNotePatch(
      note.id,
      { content: doc('from this view') },
      { expectedUpdatedAt: staleVersion, force: true },
    );
    expect(forced.status).toBe('saved');
    expect(await getNoteContent(note.id)).toEqual(doc('from this view'));
  });
});

describe('duplicating notes', () => {
  it('copies content and appends "(copy)" with a new id', async () => {
    const tab = await makeTab();
    const note = await createNote({
      tabId: tab.id,
      title: 'Recipe',
      color: '#ef4444',
      content: doc('body text'),
    });

    const copy = await duplicateNote(note.id);

    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe(note.id);
    expect(copy!.title).toBe('Recipe (copy)');
    expect(copy!.color).toBe('#ef4444');
    expect(copy!.content).toEqual(doc('body text'));
    expect(copy!.position).toBe(1);
    // The original is untouched.
    expect((await getNote(note.id))!.title).toBe('Recipe');
    expect(await countAllNotes()).toBe(2);
  });

  it('returns undefined for a missing note', async () => {
    expect(await duplicateNote('missing')).toBeUndefined();
  });
});

describe('moving notes between tabs', () => {
  it('moves a note to the end of the target tab', async () => {
    const from = await makeTab('From');
    const to = await makeTab('To');
    const note = await createNote({ tabId: from.id, title: 'Travelling' });
    await createNote({ tabId: to.id, title: 'Existing' });

    const moved = await moveNoteToTab(note.id, to.id);

    expect(moved?.tabId).toBe(to.id);
    expect(moved?.position).toBe(1);
    expect(await listNotesByTab(from.id)).toEqual([]);
    expect((await listNotesByTab(to.id)).map((item) => item.title)).toEqual([
      'Existing',
      'Travelling',
    ]);
    // The document travels with the note.
    expect(await getNoteContent(note.id)).toBeDefined();
  });

  it('is a no-op for the current tab and refuses unknown targets', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id });
    expect((await moveNoteToTab(note.id, tab.id))?.tabId).toBe(tab.id);
    expect(await moveNoteToTab(note.id, 'no-such-tab')).toBeUndefined();
    expect(await moveNoteToTab('no-such-note', tab.id)).toBeUndefined();
  });
});

describe('reordering notes', () => {
  it('moves a note up and down within its tab', async () => {
    const tab = await makeTab();
    const a = await createNote({ tabId: tab.id, title: 'A' });
    await createNote({ tabId: tab.id, title: 'B' });
    const c = await createNote({ tabId: tab.id, title: 'C' });

    expect(await moveNoteWithinTab(c.id, -1)).toBe(true);
    expect((await listNotesByTab(tab.id)).map((note) => note.title)).toEqual(['A', 'C', 'B']);

    expect(await moveNoteWithinTab(a.id, 1)).toBe(true);
    expect((await listNotesByTab(tab.id)).map((note) => note.title)).toEqual(['C', 'A', 'B']);
  });

  it('refuses to move beyond either end', async () => {
    const tab = await makeTab();
    const a = await createNote({ tabId: tab.id, title: 'A' });
    const b = await createNote({ tabId: tab.id, title: 'B' });
    expect(await moveNoteWithinTab(a.id, -1)).toBe(false);
    expect(await moveNoteWithinTab(b.id, 1)).toBe(false);
    expect(await moveNoteWithinTab('missing', 1)).toBe(false);
  });

  it('reorders correctly when positions have gaps', async () => {
    const tab = await makeTab();
    const a = await createNote({ tabId: tab.id, title: 'A' });
    const b = await createNote({ tabId: tab.id, title: 'B' });
    // Simulate a sparse sequence left by earlier edits.
    await getDatabase().notes.put({ ...(await getNote(b.id))!, position: 50 });

    expect(await moveNoteWithinTab(a.id, 1)).toBe(true);
    expect((await listNotesByTab(tab.id)).map((note) => note.title)).toEqual(['B', 'A']);
  });
});

describe('deleting and restoring notes', () => {
  it('deletes the note and its document, returning a snapshot', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id, title: 'Temp', content: doc('important') });

    const snapshot = await deleteNote(note.id);

    expect(snapshot?.meta.title).toBe('Temp');
    expect(snapshot?.content).toEqual(doc('important'));
    expect(await getNote(note.id)).toBeUndefined();
    expect(await getDatabase().contents.count()).toBe(0);
  });

  it('restores a deleted note exactly, for undo', async () => {
    const tab = await makeTab();
    const note = await createNote({ tabId: tab.id, title: 'Temp', content: doc('important') });
    const snapshot = await deleteNote(note.id);

    const restored = await restoreNote(snapshot!);

    expect(restored.id).toBe(note.id);
    expect(restored.title).toBe('Temp');
    expect(restored.position).toBe(note.position);
    expect(restored.createdAt).toBe(note.createdAt);
    expect(await getNoteContent(note.id)).toEqual(doc('important'));
  });

  it('restores into a fallback tab when the original tab is gone', async () => {
    const original = await makeTab('Original');
    const fallback = await makeTab('Fallback');
    const note = await createNote({ tabId: original.id, title: 'Orphan' });
    const snapshot = await deleteNote(note.id);
    await deleteTab(original.id);

    const restored = await restoreNote(snapshot!, fallback.id);

    expect(restored.tabId).toBe(fallback.id);
    expect((await listNotesByTab(fallback.id)).map((item) => item.title)).toEqual(['Orphan']);
  });

  it('returns undefined when deleting something that is not there', async () => {
    expect(await deleteNote('missing')).toBeUndefined();
  });
});

describe('bulk reads', () => {
  it('lists every note with its document for export', async () => {
    const a = await makeTab('A');
    const b = await makeTab('B');
    await createNote({ tabId: a.id, title: 'A1', content: doc('one') });
    await createNote({ tabId: b.id, title: 'B1', content: doc('two') });

    const all = await listAllNotesWithContent();
    expect(all).toHaveLength(2);
    expect(all.every((note) => note.content !== undefined)).toBe(true);
    expect(all.map((note) => note.plainText).sort()).toEqual(['one', 'two']);
  });

  it('counts notes per tab from the index', async () => {
    const a = await makeTab('A');
    const b = await makeTab('B');
    await createNote({ tabId: a.id });
    await createNote({ tabId: a.id });
    await createNote({ tabId: b.id });

    const counts = await noteCountsByTab();
    expect(counts).toEqual({ [a.id]: 2, [b.id]: 1 });
    expect(await listTabs()).toHaveLength(2);
  });
});
