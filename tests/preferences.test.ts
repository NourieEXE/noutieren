import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './helpers';
import {
  DEFAULT_PREFERENCES,
  __setFallbackStorageForTests,
  loadPreferences,
  sanitizePreferences,
  savePreferences,
  subscribeToPreferences,
} from '../src/services/preferences';
import {
  firstSelection,
  resolveSelectedNoteId,
  resolveSelectedTabId,
} from '../src/services/workspaceService';
import { createTab } from '../src/database/tabsRepository';
import { createNote } from '../src/database/notesRepository';
import type { NoteMeta, NoteTab } from '../src/types';

/** Stand-in for the non-extension fallback store, fresh for every test. */
let store: Map<string, string>;

beforeEach(async () => {
  await resetDatabase();
  store = new Map();
  __setFallbackStorageForTests({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  });
});

function tab(id: string, position: number): NoteTab {
  return { id, title: id, color: '#64748b', position, createdAt: 1, updatedAt: 1 };
}

function note(id: string, position: number): NoteMeta {
  return {
    id,
    tabId: 'tab',
    title: id,
    color: '#64748b',
    plainText: '',
    position,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('sanitizePreferences', () => {
  it('fills in defaults for missing or unusable input', () => {
    expect(sanitizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences('nope')).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences([])).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid values', () => {
    const result = sanitizePreferences({
      selectedTabId: 'tab-1',
      selectedNoteId: 'note-1',
      notesPanelCollapsed: true,
      theme: 'dark',
      searchAllTabs: true,
      lastExportedAt: 1750000000000,
    });
    expect(result).toEqual({
      selectedTabId: 'tab-1',
      selectedNoteId: 'note-1',
      notesPanelCollapsed: true,
      theme: 'dark',
      searchAllTabs: true,
      lastExportedAt: 1750000000000,
    });
  });

  it('rejects an unknown theme and malformed ids', () => {
    const result = sanitizePreferences({
      theme: 'neon',
      selectedTabId: { evil: true },
      selectedNoteId: 'has spaces and #symbols',
      notesPanelCollapsed: 'yes',
    });
    expect(result.theme).toBe('system');
    expect(result.selectedTabId).toBeNull();
    expect(result.selectedNoteId).toBeNull();
    // Only a real boolean counts as collapsed.
    expect(result.notesPanelCollapsed).toBe(false);
    expect(sanitizePreferences({ lastExportedAt: 'yesterday' }).lastExportedAt).toBeNull();
    expect(sanitizePreferences({ lastExportedAt: -1 }).lastExportedAt).toBeNull();
  });

  it('drops unknown keys instead of storing them', () => {
    const result = sanitizePreferences({ theme: 'light', somethingElse: 'dropped' });
    expect(Object.keys(result).sort()).toEqual([
      'lastExportedAt',
      'notesPanelCollapsed',
      'searchAllTabs',
      'selectedNoteId',
      'selectedTabId',
      'theme',
    ]);
  });
});

describe('persisting preferences', () => {
  it('round-trips through storage', async () => {
    const saved = await savePreferences(DEFAULT_PREFERENCES, {
      theme: 'dark',
      notesPanelCollapsed: true,
      selectedTabId: 'tab-9',
    });

    expect(saved.theme).toBe('dark');
    const loaded = await loadPreferences();
    expect(loaded.theme).toBe('dark');
    expect(loaded.notesPanelCollapsed).toBe(true);
    expect(loaded.selectedTabId).toBe('tab-9');
  });

  it('merges patches rather than replacing everything', async () => {
    const first = await savePreferences(DEFAULT_PREFERENCES, { theme: 'light' });
    const second = await savePreferences(first, { notesPanelCollapsed: true });
    expect(second.theme).toBe('light');
    expect(second.notesPanelCollapsed).toBe(true);
  });

  it('falls back to defaults when stored data is corrupt', async () => {
    store.set('colornote-tabs:preferences', '{not valid json');
    expect(await loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps working when the fallback store throws on every access', async () => {
    __setFallbackStorageForTests({
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
    });

    // Neither reading nor writing may propagate a failure to the caller.
    expect(await loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    await expect(savePreferences(DEFAULT_PREFERENCES, { theme: 'dark' })).resolves.toMatchObject({
      theme: 'dark',
    });
  });

  it('has no listener to detach outside an extension context', () => {
    const unsubscribe = subscribeToPreferences(() => undefined);
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('restoring the selection', () => {
  it('keeps a stored tab that still exists', () => {
    const tabs = [tab('a', 0), tab('b', 1)];
    expect(resolveSelectedTabId(tabs, 'b')).toBe('b');
  });

  it('falls back to the first tab when the stored one is gone', () => {
    const tabs = [tab('a', 0), tab('b', 1)];
    expect(resolveSelectedTabId(tabs, 'deleted')).toBe('a');
    expect(resolveSelectedTabId(tabs, null)).toBe('a');
  });

  it('returns null when there are no tabs at all', () => {
    expect(resolveSelectedTabId([], 'anything')).toBeNull();
  });

  it('keeps a stored note that is in the list, else the first', () => {
    const notes = [note('n1', 0), note('n2', 1)];
    expect(resolveSelectedNoteId(notes, 'n2')).toBe('n2');
    expect(resolveSelectedNoteId(notes, 'from-another-tab')).toBe('n1');
    expect(resolveSelectedNoteId([], 'n1')).toBeNull();
  });

  it('finds a usable first selection from the database', async () => {
    const first = await createTab({ title: 'First' });
    await createTab({ title: 'Second' });
    const firstNote = await createNote({ tabId: first.id, title: 'Note' });

    expect(await firstSelection()).toEqual({ tabId: first.id, noteId: firstNote.id });
  });

  it('reports a null note when the first tab is empty', async () => {
    const only = await createTab({ title: 'Empty' });
    expect(await firstSelection()).toEqual({ tabId: only.id, noteId: null });
  });

  it('reports nulls when there is no data', async () => {
    expect(await firstSelection()).toEqual({ tabId: null, noteId: null });
  });
});
