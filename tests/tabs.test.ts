import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './helpers';
import {
  createTab,
  countTabs,
  deleteTab,
  getTab,
  listTabs,
  moveTab,
  moveTabToIndex,
  updateTab,
} from '../src/database/tabsRepository';
import { createNote, listNotesByTab } from '../src/database/notesRepository';
import { getDatabase } from '../src/database/db';
import {
  deleteTabEnsuringOne,
  ensureSeeded,
  tabNoteCounts,
} from '../src/services/workspaceService';

beforeEach(async () => {
  await resetDatabase();
});

describe('creating tabs', () => {
  it('creates a tab with a title, color and appended position', async () => {
    const first = await createTab({ title: 'Work', color: '#ef4444' });
    const second = await createTab({ title: 'Personal' });

    expect(first.title).toBe('Work');
    expect(first.color).toBe('#ef4444');
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(first.id).not.toBe(second.id);
    expect(first.createdAt).toBeGreaterThan(0);
  });

  it('falls back to defaults for missing or invalid input', async () => {
    const tab = await createTab({ title: '   ', color: 'javascript:alert(1)' });
    expect(tab.title).toBe('General');
    expect(tab.color).toBe('#64748b');
  });

  it('has no built-in limit on the number of tabs', async () => {
    for (let i = 0; i < 60; i += 1) await createTab({ title: `Tab ${i}` });
    expect(await countTabs()).toBe(60);
    const tabs = await listTabs();
    expect(tabs.map((tab) => tab.position)).toEqual([...Array(60).keys()]);
  });
});

describe('renaming and recoloring', () => {
  it('updates the title and color and bumps updatedAt', async () => {
    const tab = await createTab({ title: 'Old' });
    const updated = await updateTab(tab.id, { title: 'New', color: '#22c55e' });

    expect(updated?.title).toBe('New');
    expect(updated?.color).toBe('#22c55e');
    expect(updated!.updatedAt).toBeGreaterThan(tab.updatedAt - 1);
    expect((await getTab(tab.id))?.title).toBe('New');
  });

  it('keeps the previous value when given something unusable', async () => {
    const tab = await createTab({ title: 'Keep', color: '#22c55e' });
    const updated = await updateTab(tab.id, { title: '  ', color: 'not-a-color' });
    expect(updated?.title).toBe('Keep');
    expect(updated?.color).toBe('#22c55e');
  });

  it('returns undefined for a tab that no longer exists', async () => {
    expect(await updateTab('missing-id', { title: 'x' })).toBeUndefined();
  });
});

describe('reordering tabs', () => {
  it('moves a tab left and right', async () => {
    const a = await createTab({ title: 'A' });
    await createTab({ title: 'B' });
    const c = await createTab({ title: 'C' });

    expect(await moveTab(c.id, -1)).toBe(true);
    expect((await listTabs()).map((tab) => tab.title)).toEqual(['A', 'C', 'B']);

    expect(await moveTab(a.id, 1)).toBe(true);
    expect((await listTabs()).map((tab) => tab.title)).toEqual(['C', 'A', 'B']);
  });

  it('refuses to move past either end', async () => {
    const a = await createTab({ title: 'A' });
    await createTab({ title: 'B' });
    const last = (await listTabs())[1];
    expect(await moveTab(a.id, -1)).toBe(false);
    expect(await moveTab(last.id, 1)).toBe(false);
    expect((await listTabs()).map((tab) => tab.title)).toEqual(['A', 'B']);
  });

  it('moves a tab to an absolute index', async () => {
    await createTab({ title: 'A' });
    await createTab({ title: 'B' });
    const c = await createTab({ title: 'C' });

    expect(await moveTabToIndex(c.id, 0)).toBe(true);
    expect((await listTabs()).map((tab) => tab.title)).toEqual(['C', 'A', 'B']);
    // Out-of-range indexes are clamped rather than rejected.
    expect(await moveTabToIndex(c.id, 99)).toBe(true);
    expect((await listTabs()).map((tab) => tab.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('deleting tabs', () => {
  it('deletes the tab, its notes and their documents', async () => {
    const tab = await createTab({ title: 'Doomed' });
    const other = await createTab({ title: 'Kept' });
    await createNote({ tabId: tab.id, title: 'One' });
    await createNote({ tabId: tab.id, title: 'Two' });
    const survivor = await createNote({ tabId: other.id, title: 'Survivor' });

    const result = await deleteTab(tab.id);

    expect(result.deletedNotes).toBe(2);
    expect(await getTab(tab.id)).toBeUndefined();
    expect(await listNotesByTab(tab.id)).toEqual([]);
    // No orphaned documents are left behind.
    expect(await getDatabase().contents.count()).toBe(1);
    expect((await listNotesByTab(other.id)).map((note) => note.id)).toEqual([survivor.id]);
  });

  it('renumbers the remaining tabs densely', async () => {
    const a = await createTab({ title: 'A' });
    const b = await createTab({ title: 'B' });
    const c = await createTab({ title: 'C' });
    await deleteTab(b.id);

    const tabs = await listTabs();
    expect(tabs.map((tab) => [tab.title, tab.position])).toEqual([
      ['A', 0],
      ['C', 1],
    ]);
    expect(tabs.map((tab) => tab.id)).toEqual([a.id, c.id]);
  });

  it('recreates a General tab when the last one is deleted', async () => {
    const only = await createTab({ title: 'Only' });
    await createNote({ tabId: only.id, title: 'Note' });

    const { deletedNotes, replacementTab } = await deleteTabEnsuringOne(only.id);

    expect(deletedNotes).toBe(1);
    expect(replacementTab?.title).toBe('General');
    expect(await countTabs()).toBe(1);
    // The replacement is genuinely new, not the deleted tab.
    expect(replacementTab?.id).not.toBe(only.id);
  });

  it('does not create a replacement when other tabs remain', async () => {
    const a = await createTab({ title: 'A' });
    await createTab({ title: 'B' });
    const { replacementTab } = await deleteTabEnsuringOne(a.id);
    expect(replacementTab).toBeNull();
    expect(await countTabs()).toBe(1);
  });
});

describe('first-run seeding', () => {
  it('creates one General tab holding one blank note', async () => {
    const result = await ensureSeeded();
    expect(result.seeded).toBe(true);

    const tabs = await listTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].title).toBe('General');

    const notes = await listNotesByTab(tabs[0].id);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('New note');
    expect(notes[0].plainText).toBe('');
  });

  it('does nothing when data already exists', async () => {
    await ensureSeeded();
    const second = await ensureSeeded();
    expect(second.seeded).toBe(false);
    expect(await countTabs()).toBe(1);
  });

  it('is safe when two views seed concurrently', async () => {
    await Promise.all([ensureSeeded(), ensureSeeded(), ensureSeeded()]);
    expect(await countTabs()).toBe(1);
    expect(await getDatabase().notes.count()).toBe(1);
  });
});

describe('note counts per tab', () => {
  it('counts notes for each tab', async () => {
    const a = await createTab({ title: 'A' });
    const b = await createTab({ title: 'B' });
    await createNote({ tabId: a.id });
    await createNote({ tabId: a.id });
    await createNote({ tabId: b.id });

    const counts = await tabNoteCounts(await listTabs());
    expect(counts[a.id]).toBe(2);
    expect(counts[b.id]).toBe(1);
  });
});
