import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, resetDatabase } from './helpers';
import { createTab, listTabs } from '../src/database/tabsRepository';
import {
  countAllNotes,
  createNote,
  getNoteContent,
  listAllNotesWithContent,
  listNotesByTab,
} from '../src/database/notesRepository';
import {
  APPLICATION_NAME,
  ImportValidationError,
  backupFilename,
  createBackup,
  importBackup,
  importWithSafetyBackup,
  parseBackup,
  resetAllData,
  serializeBackup,
} from '../src/services/backupService';
import { BACKUP_FORMAT_VERSION } from '../src/types';
import { SCHEMA_VERSION } from '../src/database/db';
import { DEFAULT_PREFERENCES } from '../src/services/preferences';

beforeEach(async () => {
  await resetDatabase();
});

async function seedWorkspace() {
  const work = await createTab({ title: 'Work', color: '#0ea5e9' });
  const home = await createTab({ title: 'Home', color: '#22c55e' });
  const first = await createNote({
    tabId: work.id,
    title: 'Sprint',
    color: '#ef4444',
    content: doc('plan the sprint'),
  });
  const second = await createNote({ tabId: home.id, title: 'Shopping', content: doc('oat milk') });
  return { work, home, first, second };
}

/** A minimal valid backup, used as the base for validation tests. */
function validBackup(overrides: Record<string, unknown> = {}) {
  return {
    application: APPLICATION_NAME,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
    tabs: [
      {
        id: 'tab-1',
        title: 'Imported tab',
        color: '#a855f7',
        position: 0,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ],
    notes: [
      {
        id: 'note-1',
        tabId: 'tab-1',
        title: 'Imported note',
        color: '#f59e0b',
        plainText: 'imported body',
        position: 0,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        content: doc('imported body'),
      },
    ],
    preferences: { theme: 'dark', notesPanelCollapsed: true },
    ...overrides,
  };
}

describe('export', () => {
  it('includes the application, format version, timestamp, tabs, notes and preferences', async () => {
    const { first } = await seedWorkspace();
    const backup = await createBackup({ ...DEFAULT_PREFERENCES, theme: 'dark' });

    expect(backup.application).toBe(APPLICATION_NAME);
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.exportedAt).toBeGreaterThan(0);
    expect(backup.tabs).toHaveLength(2);
    expect(backup.notes).toHaveLength(2);
    expect(backup.preferences.theme).toBe('dark');

    // Notes carry their document, colors, ordering and timestamps.
    const exported = backup.notes.find((note) => note.id === first.id);
    expect(exported?.content).toEqual(doc('plan the sprint'));
    expect(exported?.color).toBe('#ef4444');
    expect(exported?.position).toBe(0);
    expect(exported?.createdAt).toBe(first.createdAt);
  });

  it('serializes to readable, re-parsable JSON', async () => {
    await seedWorkspace();
    const text = serializeBackup(await createBackup());

    expect(text).toContain('\n  "application"');
    expect(text.endsWith('\n')).toBe(true);
    expect(() => parseBackup(text)).not.toThrow();
  });

  it('names the file with the current date', () => {
    expect(backupFilename(new Date('2026-07-25T10:00:00Z'))).toBe(
      'noutieren-backup-2026-07-25.json',
    );
    expect(backupFilename(new Date('2026-07-25T10:00:00Z'), '-before-import')).toContain(
      '-before-import.json',
    );
  });

  it('round-trips an exported workspace exactly', async () => {
    const { first } = await seedWorkspace();
    const text = serializeBackup(await createBackup());
    await resetDatabase();

    await importBackup(parseBackup(text), 'replace');

    const tabs = await listTabs();
    expect(tabs.map((tab) => tab.title)).toEqual(['Work', 'Home']);
    const notes = await listAllNotesWithContent();
    expect(notes).toHaveLength(2);
    expect(notes.find((note) => note.id === first.id)?.content).toEqual(doc('plan the sprint'));
  });
});

describe('import validation', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(ImportValidationError);
    expect(() => parseBackup('')).toThrow(/valid JSON/i);
  });

  it('rejects JSON that is not a backup object', () => {
    expect(() => parseBackup('[]')).toThrow(/backup object/i);
    expect(() => parseBackup('"a string"')).toThrow(/backup object/i);
    expect(() => parseBackup('null')).toThrow(/backup object/i);
  });

  it('rejects a missing or non-numeric format version', () => {
    expect(() => parseBackup(JSON.stringify(validBackup({ formatVersion: undefined })))).toThrow(
      /format version/i,
    );
    expect(() => parseBackup(JSON.stringify(validBackup({ formatVersion: 'one' })))).toThrow(
      /format version/i,
    );
  });

  it('rejects a backup from a newer version of the extension', () => {
    expect(() =>
      parseBackup(JSON.stringify(validBackup({ formatVersion: BACKUP_FORMAT_VERSION + 5 }))),
    ).toThrow(/newer than this extension supports/i);
  });

  it('rejects missing tab or note collections', () => {
    expect(() => parseBackup(JSON.stringify(validBackup({ tabs: undefined })))).toThrow(
      /list of tabs/i,
    );
    expect(() => parseBackup(JSON.stringify(validBackup({ notes: 'nope' })))).toThrow(
      /list of notes/i,
    );
  });

  it('rejects a backup with nothing in it', () => {
    expect(() => parseBackup(JSON.stringify(validBackup({ tabs: [], notes: [] })))).toThrow(
      /no tabs and no notes/i,
    );
  });

  it('rejects an implausibly large document', () => {
    const huge = {
      type: 'doc',
      content: Array.from({ length: 100_010 }, () => ({ type: 'paragraph' })),
    };
    const file = validBackup();
    file.notes[0].content = huge;
    expect(() => parseBackup(JSON.stringify(file))).toThrow(/implausibly large/i);
  });

  it('accepts a valid backup and normalizes it', () => {
    const parsed = parseBackup(JSON.stringify(validBackup()));
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.repairs).toEqual([]);
    expect(parsed.preferences.theme).toBe('dark');
    expect(parsed.preferences.notesPanelCollapsed).toBe(true);
  });

  it('still imports backups written under the old product name', async () => {
    // The extension was renamed from "ColorNote Tabs" to "Noutieren". Import
    // must not care what a file calls itself, or the rename would strand every
    // backup taken before it.
    const legacy = validBackup({ application: 'ColorNote Tabs' });
    const parsed = parseBackup(JSON.stringify(legacy));

    expect(parsed.repairs).toEqual([]);
    expect(parsed.notes).toHaveLength(1);

    await importBackup(parsed, 'replace');
    expect(await countAllNotes()).toBe(1);
    expect(await getNoteContent('note-1')).toEqual(doc('imported body'));
  });

  it('does not reject a backup for having an unexpected application name', () => {
    for (const name of ['Something Else', '', 12345, null, undefined]) {
      expect(() => parseBackup(JSON.stringify(validBackup({ application: name })))).not.toThrow();
    }
  });
});

describe('import repairs', () => {
  it('replaces invalid colors, titles and timestamps', () => {
    const file = validBackup();
    file.tabs[0].color = 'javascript:alert(1)';
    file.tabs[0].title = '   ';
    file.notes[0].color = 'not-a-color';
    file.notes[0].createdAt = -5;

    const parsed = parseBackup(JSON.stringify(file));

    expect(parsed.tabs[0].color).toBe('#64748b');
    expect(parsed.tabs[0].title).toBe('Untitled tab');
    expect(parsed.notes[0].color).toBe('#64748b');
    expect(parsed.notes[0].createdAt).toBeGreaterThan(0);
    expect(parsed.repairs.length).toBeGreaterThan(0);
  });

  it('moves notes that reference a missing tab into the first tab', () => {
    const file = validBackup();
    file.notes[0].tabId = 'tab-does-not-exist';

    const parsed = parseBackup(JSON.stringify(file));

    expect(parsed.notes[0].tabId).toBe(parsed.tabs[0].id);
    expect(parsed.repairs.join(' ')).toMatch(/referenced a missing tab/i);
  });

  it('creates an Imported tab when the file has notes but no tabs', () => {
    const parsed = parseBackup(JSON.stringify(validBackup({ tabs: [] })));
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.tabs[0].title).toBe('Imported');
    expect(parsed.notes[0].tabId).toBe(parsed.tabs[0].id);
  });

  it('gives new ids to duplicates inside the file', () => {
    const file = validBackup();
    file.tabs.push({ ...file.tabs[0] });
    file.notes.push({ ...file.notes[0] });

    const parsed = parseBackup(JSON.stringify(file));

    expect(new Set(parsed.tabs.map((tab) => tab.id)).size).toBe(2);
    expect(new Set(parsed.notes.map((note) => note.id)).size).toBe(2);
    expect(parsed.repairs.join(' ')).toMatch(/duplicate id/i);
  });

  it('never executes or trusts imported content', () => {
    const file = validBackup();
    file.notes[0].content = {
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)' },
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    // A lie in the file: plainText claiming words the document does not contain.
    file.notes[0].plainText = 'totally different searchable text';

    const parsed = parseBackup(JSON.stringify(file));
    const serialized = JSON.stringify(parsed.notes[0]);

    expect(serialized).not.toContain('script');
    expect(serialized).not.toContain('javascript');
    expect(serialized).not.toContain('onclick');
    // plainText is regenerated from the sanitized document.
    expect(parsed.notes[0].plainText).toBe('link');
  });

  it('renumbers positions densely per tab', () => {
    const file = validBackup();
    file.notes = [
      { ...file.notes[0], id: 'n1', position: 50 },
      { ...file.notes[0], id: 'n2', position: 10 },
      { ...file.notes[0], id: 'n3', position: 30 },
    ];
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.notes.map((note) => note.position).sort()).toEqual([0, 1, 2]);
    // Relative order is preserved.
    const byId = new Map(parsed.notes.map((note) => [note.id, note.position]));
    expect(byId.get('n2')).toBe(0);
    expect(byId.get('n3')).toBe(1);
    expect(byId.get('n1')).toBe(2);
  });

  it('drops a selection that points outside the imported data', () => {
    const parsed = parseBackup(
      JSON.stringify(
        validBackup({ preferences: { selectedTabId: 'ghost', selectedNoteId: 'ghost' } }),
      ),
    );
    expect(parsed.preferences.selectedTabId).toBeNull();
    expect(parsed.preferences.selectedNoteId).toBeNull();
  });
});

describe('replace import', () => {
  it('removes existing data and installs the backup', async () => {
    await seedWorkspace();
    const parsed = parseBackup(JSON.stringify(validBackup()));

    const summary = await importBackup(parsed, 'replace');

    expect(summary.mode).toBe('replace');
    expect(summary.tabsImported).toBe(1);
    expect(summary.notesImported).toBe(1);
    const tabs = await listTabs();
    expect(tabs.map((tab) => tab.title)).toEqual(['Imported tab']);
    expect(await countAllNotes()).toBe(1);
    expect(await getNoteContent('note-1')).toEqual(doc('imported body'));
  });

  it('hands the caller a safety copy before replacing anything', async () => {
    await seedWorkspace();
    const safety = vi.fn();

    await importWithSafetyBackup(parseBackup(JSON.stringify(validBackup())), 'replace', safety);

    expect(safety).toHaveBeenCalledTimes(1);
    const handed = safety.mock.calls[0][0];
    // The safety copy holds the data as it was *before* the import.
    expect(handed.tabs.map((tab: { title: string }) => tab.title)).toEqual(['Work', 'Home']);
    expect(handed.notes).toHaveLength(2);
  });

  it('does not produce a safety copy for a merge, or when there is nothing to lose', async () => {
    const safety = vi.fn();
    await importWithSafetyBackup(parseBackup(JSON.stringify(validBackup())), 'merge', safety);
    expect(safety).not.toHaveBeenCalled();

    await resetDatabase();
    await importWithSafetyBackup(parseBackup(JSON.stringify(validBackup())), 'replace', safety);
    expect(safety).not.toHaveBeenCalled();
  });
});

describe('merge import', () => {
  it('keeps existing notes and adds the imported ones after them', async () => {
    await seedWorkspace();
    const parsed = parseBackup(JSON.stringify(validBackup()));

    const summary = await importBackup(parsed, 'merge');

    expect(summary.mode).toBe('merge');
    const tabs = await listTabs();
    expect(tabs.map((tab) => tab.title)).toEqual(['Work', 'Home', 'Imported tab']);
    expect(tabs.map((tab) => tab.position)).toEqual([0, 1, 2]);
    expect(await countAllNotes()).toBe(3);
  });

  it('reassigns colliding ids and repairs the note references', async () => {
    const existingTab = await createTab({ title: 'Existing' });
    const existingNote = await createNote({ tabId: existingTab.id, title: 'Mine' });

    // A file whose ids deliberately collide with what is already stored.
    const file = validBackup();
    file.tabs[0].id = existingTab.id;
    file.notes[0].id = existingNote.id;
    file.notes[0].tabId = existingTab.id;

    const summary = await importBackup(parseBackup(JSON.stringify(file)), 'merge');

    expect(summary.notesReassigned).toBe(1);
    expect(await countAllNotes()).toBe(2);

    // The original note kept its identity and content.
    const mine = await listNotesByTab(existingTab.id);
    expect(mine.map((note) => note.title)).toEqual(['Mine']);

    // The imported note landed in the imported tab, not the existing one.
    const tabs = await listTabs();
    const importedTab = tabs.find((tab) => tab.id !== existingTab.id);
    expect(importedTab).toBeDefined();
    const imported = await listNotesByTab(importedTab!.id);
    expect(imported.map((note) => note.title)).toEqual(['Imported note']);
    expect(imported[0].id).not.toBe(existingNote.id);
    // Its document came along under the new id.
    expect(await getNoteContent(imported[0].id)).toEqual(doc('imported body'));
  });

  it('marks a tab whose title already exists', async () => {
    await createTab({ title: 'Imported tab' });
    const summary = await importBackup(parseBackup(JSON.stringify(validBackup())), 'merge');

    expect(summary.tabsRenamedForCollision).toBe(1);
    const titles = (await listTabs()).map((tab) => tab.title);
    expect(titles).toContain('Imported tab');
    expect(titles).toContain('Imported tab (imported)');
  });

  it('preserves every imported note even with repeated merges', async () => {
    await importBackup(parseBackup(JSON.stringify(validBackup())), 'merge');
    await importBackup(parseBackup(JSON.stringify(validBackup())), 'merge');
    await importBackup(parseBackup(JSON.stringify(validBackup())), 'merge');

    expect(await countAllNotes()).toBe(3);
    expect(await listTabs()).toHaveLength(3);
  });
});

describe('reset', () => {
  it('deletes everything and recreates the default tab and note', async () => {
    await seedWorkspace();

    await resetAllData();

    const tabs = await listTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].title).toBe('General');
    const notes = await listNotesByTab(tabs[0].id);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('New note');
    expect(await countAllNotes()).toBe(1);
  });

  it('leaves no orphaned documents behind', async () => {
    await seedWorkspace();
    await resetAllData();
    const notes = await listAllNotesWithContent();
    expect(notes).toHaveLength(1);
  });
});
