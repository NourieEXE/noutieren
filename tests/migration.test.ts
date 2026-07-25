import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { doc } from './helpers';
import {
  NoutierenDatabase,
  SCHEMA_VERSION,
  __setDatabaseForTests,
  openDatabase,
  readRecordedSchemaVersion,
} from '../src/database/db';
import { listNotesByTab } from '../src/database/notesRepository';
import { listTabs } from '../src/database/tabsRepository';

/**
 * Migration behaviour.
 *
 * A v1 database is built with the historical schema (documents stored inline on
 * the note row), then opened with the current schema to prove the upgrade
 * preserves user data rather than dropping it.
 */

const V1_STORES = {
  tabs: 'id, position, updatedAt',
  notes: 'id, tabId, [tabId+position], position, updatedAt',
  meta: 'key',
};

async function createLegacyDatabase(name: string) {
  const legacy = new Dexie(name);
  legacy.version(1).stores(V1_STORES);
  await legacy.open();

  await legacy.table('tabs').bulkPut([
    { id: 'tab-1', title: 'Legacy tab', color: '#ef4444', position: 0, createdAt: 1, updatedAt: 2 },
    { id: 'tab-2', title: 'Second', color: '#22c55e', position: 1, createdAt: 1, updatedAt: 2 },
  ]);
  await legacy.table('notes').bulkPut([
    {
      id: 'note-1',
      tabId: 'tab-1',
      title: 'Legacy note',
      color: '#f59e0b',
      plainText: 'legacy body',
      position: 0,
      createdAt: 10,
      updatedAt: 20,
      // v1 kept the document on the note row.
      content: doc('legacy body'),
    },
    {
      id: 'note-2',
      tabId: 'tab-2',
      title: 'Another',
      color: '#64748b',
      plainText: '',
      position: 0,
      createdAt: 11,
      updatedAt: 21,
      content: doc('second body'),
    },
  ]);

  legacy.close();
}

afterEach(() => {
  __setDatabaseForTests(null);
});

describe('v1 to v2 migration', () => {
  it('moves inline documents into the contents table without losing anything', async () => {
    const name = `noutieren-migration-${Date.now()}`;
    await createLegacyDatabase(name);

    const db = new NoutierenDatabase(name);
    __setDatabaseForTests(db);
    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);

    // Tabs survived untouched.
    const tabs = await listTabs();
    expect(tabs.map((tab) => tab.title)).toEqual(['Legacy tab', 'Second']);
    expect(tabs[0].color).toBe('#ef4444');

    // Note metadata survived, including timestamps and ordering.
    const notes = await listNotesByTab('tab-1');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Legacy note');
    expect(notes[0].createdAt).toBe(10);
    expect(notes[0].updatedAt).toBe(20);
    expect(notes[0].color).toBe('#f59e0b');

    // Documents moved to their own table…
    expect((await db.contents.get('note-1'))?.content).toEqual(doc('legacy body'));
    expect((await db.contents.get('note-2'))?.content).toEqual(doc('second body'));

    // …and no longer duplicate on the note row.
    const raw = (await db.notes.get('note-1')) as unknown as Record<string, unknown>;
    expect(raw.content).toBeUndefined();

    await db.delete();
  });

  it('is idempotent when the database is already current', async () => {
    const name = `noutieren-current-${Date.now()}`;
    const first = new NoutierenDatabase(name);
    __setDatabaseForTests(first);
    await openDatabase();
    await first.tabs.put({
      id: 'tab-a',
      title: 'Kept',
      color: '#64748b',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    first.close();

    const second = new NoutierenDatabase(name);
    __setDatabaseForTests(second);
    await openDatabase();

    expect((await listTabs()).map((tab) => tab.title)).toEqual(['Kept']);
    expect(await readRecordedSchemaVersion()).toBe(SCHEMA_VERSION);

    await second.delete();
  });

  it('records the schema version so future upgrades can be detected', async () => {
    const name = `noutieren-version-${Date.now()}`;
    const db = new NoutierenDatabase(name);
    __setDatabaseForTests(db);

    await openDatabase();

    expect(await readRecordedSchemaVersion()).toBe(SCHEMA_VERSION);
    await db.delete();
  });

  it('creates all four object stores with the indexes queries rely on', async () => {
    const name = `noutieren-indexes-${Date.now()}`;
    const db = new NoutierenDatabase(name);
    __setDatabaseForTests(db);
    await db.open();

    const names = db.tables.map((table) => table.name).sort();
    expect(names).toEqual(['contents', 'meta', 'notes', 'tabs']);

    const noteIndexes = db.notes.schema.indexes.map((index) => index.name);
    expect(noteIndexes).toContain('tabId');
    expect(noteIndexes).toContain('[tabId+position]');
    expect(noteIndexes).toContain('updatedAt');
    expect(db.tabs.schema.indexes.map((index) => index.name)).toContain('position');

    await db.delete();
  });
});
