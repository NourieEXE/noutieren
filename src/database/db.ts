import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { JSONContent, NoteContentRow, NoteMeta, NoteTab } from '../types';

/**
 * IndexedDB database name.
 *
 * **Do not change this.** It is a storage identity, not a display name: it
 * still reads `colornote-tabs` from before the extension was renamed to
 * Noutieren, and renaming it would point at a different, empty database and
 * appear to every existing user as though all their notes had vanished.
 *
 * The same applies to `browser_specific_settings.gecko.id` in the manifest,
 * which determines the `moz-extension://` origin that owns this database.
 *
 * If it ever has to change, ship a migration that copies the old database
 * across, or require an export/import cycle.
 */
export const DATABASE_NAME = 'colornote-tabs';

/**
 * Current IndexedDB schema version.
 *
 * Bump this and append a new `this.version(n)` block with an `.upgrade()`
 * handler; never edit an existing version block, or installed databases will
 * fail to open. Recorded in the `meta` table and in every backup file.
 */
export const SCHEMA_VERSION = 3;

export interface MetaRow {
  key: string;
  value: unknown;
}

/** A v1 note row, which carried its rich-text document inline. */
type LegacyNoteRow = NoteMeta & { content?: JSONContent };

export class NoutierenDatabase extends Dexie {
  tabs!: EntityTable<NoteTab, 'id'>;
  notes!: EntityTable<NoteMeta, 'id'>;
  contents!: EntityTable<NoteContentRow, 'noteId'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name: string = DATABASE_NAME) {
    super(name);

    // v1 — notes stored their document inline.
    this.version(1).stores({
      tabs: 'id, position, updatedAt',
      notes: 'id, tabId, [tabId+position], position, updatedAt',
      meta: 'key',
    });

    // v2 — documents live in `contents`, so listing notes, building previews
    // and searching never deserialise a single ProseMirror document.
    this.version(2)
      .stores({
        tabs: 'id, position, updatedAt',
        notes: 'id, tabId, [tabId+position], position, updatedAt',
        contents: 'noteId',
        meta: 'key',
      })
      .upgrade(async (tx: Transaction) => {
        const notes = tx.table<LegacyNoteRow, string>('notes');
        const contents = tx.table<NoteContentRow, string>('contents');
        const rows = await notes.toArray();
        for (const row of rows) {
          if (!row.content) continue;
          await contents.put({ noteId: row.id, content: row.content });
          const { content: _legacyContent, ...rest } = row;
          await notes.put(rest);
        }
      });

    // v3 — tabs and notes may carry `urlPatterns` ("Pin to URL").
    //
    // No `.upgrade()` and no index. The field is optional, and a row without it
    // is exactly what an unpinned item looks like, so every existing row is
    // already correct and rewriting them would be pure churn. It is left
    // unindexed because visibility is decided in memory over the tab list and
    // the open tab's notes, never by a range query.
    this.version(3).stores({
      tabs: 'id, position, updatedAt',
      notes: 'id, tabId, [tabId+position], position, updatedAt',
      contents: 'noteId',
      meta: 'key',
    });
  }
}

let instance: NoutierenDatabase | null = null;

/** The shared database handle. Tests can pass an isolated name. */
export function getDatabase(): NoutierenDatabase {
  instance ??= new NoutierenDatabase();
  return instance;
}

/** Replaces the shared handle. Only used by tests. */
export function __setDatabaseForTests(db: NoutierenDatabase | null): void {
  instance = db;
}

/**
 * Opens the database and records the schema version.
 *
 * Surfacing failure here (rather than on first query) lets the UI show one
 * clear message instead of a cascade of broken panels.
 */
export async function openDatabase(): Promise<NoutierenDatabase> {
  const db = getDatabase();
  if (!db.isOpen()) await db.open();
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  return db;
}

/** Reads the schema version recorded in the database, if any. */
export async function readRecordedSchemaVersion(): Promise<number | null> {
  const row = await getDatabase().meta.get('schemaVersion');
  return typeof row?.value === 'number' ? row.value : null;
}
