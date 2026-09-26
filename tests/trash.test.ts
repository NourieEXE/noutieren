import { beforeEach, describe, expect, it } from 'vitest';
import { doc, resetDatabase } from './helpers';
import { createTab, deleteTab, getTab, listTabs } from '../src/database/tabsRepository';
import {
  applyNotePatch,
  createNote,
  deleteNote,
  getNote,
  getNoteContent,
  listNotesByTab,
  noteCountsByTab,
  searchNotes,
} from '../src/database/notesRepository';
import {
  TRASH_RETENTION_DAYS,
  deleteForever,
  emptyTrash,
  listTrash,
  purgeExpiredTrash,
  restoreFromTrash,
} from '../src/database/trashRepository';
import { resetAllData } from '../src/services/backupService';
import { getDatabase } from '../src/database/db';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDatabase();
});

describe('restoring a deleted note', () => {
  it('puts it back exactly where it was', async () => {
    const tab = await createTab({ title: 'Work' });
    await createNote({ tabId: tab.id, title: 'First' });
    const note = await createNote({ tabId: tab.id, title: 'Middle', content: doc('important') });
    await createNote({ tabId: tab.id, title: 'Last' });
    await deleteNote(note.id);

    const restored = await restoreFromTrash(note.id);

    expect(restored?.id).toBe(note.id);
    expect(restored?.createdAt).toBe(note.createdAt);
    expect((await listNotesByTab(tab.id)).map((item) => item.title)).toEqual([
      'First',
      'Middle',
      'Last',
    ]);
    expect(await getNoteContent(note.id)).toEqual(doc('important'));
    expect(await listTrash()).toEqual([]);
  });

  it('goes to the end of the tab when its old slot has been taken', async () => {
    const tab = await createTab({ title: 'Work' });
    const note = await createNote({ tabId: tab.id, title: 'Deleted' });
    await deleteNote(note.id);
    await createNote({ tabId: tab.id, title: 'New' });

    await restoreFromTrash(note.id);

    const notes = await listNotesByTab(tab.id);
    expect(notes.map((item) => item.title)).toEqual(['New', 'Deleted']);
    expect(new Set(notes.map((item) => item.position)).size).toBe(2);
  });

  it('brings its tab back when the tab was deleted too, once for all its notes', async () => {
    await createTab({ title: 'Kept' });
    const tab = await createTab({ title: 'Doomed', color: '#ef4444' });
    const one = await createNote({ tabId: tab.id, title: 'One' });
    const two = await createNote({ tabId: tab.id, title: 'Two' });
    await deleteTab(tab.id);
    expect(await getTab(tab.id)).toBeUndefined();

    await restoreFromTrash(two.id);
    await restoreFromTrash(one.id);

    const tabs = await listTabs();
    expect(tabs.map((item) => [item.title, item.color])).toEqual([
      ['Kept', '#64748b'],
      ['Doomed', '#ef4444'],
    ]);
    expect((await listNotesByTab(tab.id)).map((item) => item.title)).toEqual(['One', 'Two']);
  });

  it('gives the note a new id rather than overwrite a note that took the old one', async () => {
    const tab = await createTab({ title: 'Work' });
    const note = await createNote({ tabId: tab.id, title: 'Deleted' });
    await deleteNote(note.id);
    // An import can bring a note with the same id back in the meantime.
    await getDatabase().notes.put({ ...note, title: 'Imported' });

    const restored = await restoreFromTrash(note.id);

    expect(restored?.id).not.toBe(note.id);
    expect((await getNote(note.id))?.title).toBe('Imported');
    expect((await getNote(restored!.id))?.title).toBe('Deleted');
  });

  it('returns undefined for a note that is not in the trash', async () => {
    expect(await restoreFromTrash('missing')).toBeUndefined();
  });
});

describe('what the trash hides', () => {
  it('is left out of note lists, counts and search', async () => {
    const tab = await createTab({ title: 'Work' });
    const note = await createNote({ tabId: tab.id, title: 'Findable' });
    await applyNotePatch(note.id, { content: doc('needle') });
    await deleteNote(note.id);

    expect(await listNotesByTab(tab.id)).toEqual([]);
    expect((await noteCountsByTab())[tab.id]).toBeUndefined();
    expect(await searchNotes({ query: 'needle', scope: 'all' })).toEqual([]);
  });
});

describe('clearing the trash', () => {
  it('lists newest first', async () => {
    const tab = await createTab({ title: 'Work' });
    const older = await createNote({ tabId: tab.id, title: 'Older' });
    const newer = await createNote({ tabId: tab.id, title: 'Newer' });
    await deleteNote(older.id);
    await deleteNote(newer.id);
    await getDatabase().trash.update(older.id, { deletedAt: Date.now() - DAY });

    expect((await listTrash()).map((entry) => entry.meta.title)).toEqual(['Newer', 'Older']);
  });

  it(`drops entries older than ${TRASH_RETENTION_DAYS} days and keeps the rest`, async () => {
    const tab = await createTab({ title: 'Work' });
    const expired = await createNote({ tabId: tab.id, title: 'Expired' });
    const recent = await createNote({ tabId: tab.id, title: 'Recent' });
    await deleteNote(expired.id);
    await deleteNote(recent.id);
    const now = Date.now();
    await getDatabase().trash.update(expired.id, {
      deletedAt: now - (TRASH_RETENTION_DAYS + 1) * DAY,
    });
    await getDatabase().trash.update(recent.id, {
      deletedAt: now - (TRASH_RETENTION_DAYS - 1) * DAY,
    });

    expect(await purgeExpiredTrash(now)).toBe(1);
    expect((await listTrash()).map((entry) => entry.meta.title)).toEqual(['Recent']);
  });

  it('deletes one entry forever, or all of them', async () => {
    const tab = await createTab({ title: 'Work' });
    const a = await createNote({ tabId: tab.id, title: 'A' });
    const b = await createNote({ tabId: tab.id, title: 'B' });
    const c = await createNote({ tabId: tab.id, title: 'C' });
    for (const note of [a, b, c]) await deleteNote(note.id);

    await deleteForever(b.id);
    expect((await listTrash()).map((entry) => entry.noteId).sort()).toEqual([a.id, c.id].sort());

    await emptyTrash();
    expect(await listTrash()).toEqual([]);
  });

  it('is emptied by a reset', async () => {
    const tab = await createTab({ title: 'Work' });
    const note = await createNote({ tabId: tab.id, title: 'Gone' });
    await deleteNote(note.id);

    await resetAllData();

    expect(await listTrash()).toEqual([]);
  });
});
