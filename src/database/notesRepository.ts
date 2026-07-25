import Dexie from 'dexie';
import { getDatabase } from './db';
import type { JSONContent, Note, NoteMeta, NotePatch, SearchScope } from '../types';
import { createId } from '../utils/id';
import { DEFAULT_NOTE_COLOR, normalizeColor } from '../utils/colors';
import { createEmptyDocument, extractPlainText } from '../editor/document';

/**
 * All note reads and writes.
 *
 * Metadata (`notes`) and rich-text documents (`contents`) are separate tables:
 * the notes list, previews and search touch only metadata, and a document is
 * read when its note is opened.
 */

export const DEFAULT_NOTE_TITLE = 'New note';

/** Everything needed to restore a deleted note, for undo. */
export interface NoteSnapshot {
  meta: NoteMeta;
  content: JSONContent;
}

export type PatchResult =
  | { status: 'saved'; updatedAt: number }
  | { status: 'conflict'; currentUpdatedAt: number }
  | { status: 'missing' };

function tabRange(tabId: string) {
  return getDatabase()
    .notes.where('[tabId+position]')
    .between([tabId, Dexie.minKey], [tabId, Dexie.maxKey]);
}

/** Notes in a tab, ordered by position, without their documents. */
export async function listNotesByTab(tabId: string): Promise<NoteMeta[]> {
  return tabRange(tabId).toArray();
}

export async function getNote(id: string): Promise<NoteMeta | undefined> {
  return getDatabase().notes.get(id);
}

export async function getNoteContent(noteId: string): Promise<JSONContent | undefined> {
  const row = await getDatabase().contents.get(noteId);
  return row?.content;
}

/** Metadata plus document, as used by export and duplication. */
export async function getFullNote(id: string): Promise<Note | undefined> {
  const db = getDatabase();
  return db.transaction('r', db.notes, db.contents, async () => {
    const meta = await db.notes.get(id);
    if (!meta) return undefined;
    const content = (await db.contents.get(id))?.content ?? createEmptyDocument();
    return { ...meta, content };
  });
}

export async function countNotesByTab(tabIds: readonly string[]): Promise<Record<string, number>> {
  const db = getDatabase();
  const entries = await Promise.all(
    tabIds.map(
      async (tabId) => [tabId, await db.notes.where('tabId').equals(tabId).count()] as const,
    ),
  );
  return Object.fromEntries(entries);
}

export async function countAllNotes(): Promise<number> {
  return getDatabase().notes.count();
}

/**
 * Note counts for every tab, for the tab badges.
 *
 * Walks the `tabId` index keys only, so no note rows are deserialised — this
 * stays cheap with thousands of notes and re-runs on every live update.
 */
export async function noteCountsByTab(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await getDatabase()
    .notes.orderBy('tabId')
    .eachKey((key) => {
      // `tabId` is always a string; anything else would be a corrupt row.
      if (typeof key !== 'string') return;
      counts[key] = (counts[key] ?? 0) + 1;
    });
  return counts;
}

/** Every note with its document, ordered by tab then position. Used by export. */
export async function listAllNotesWithContent(): Promise<Note[]> {
  const db = getDatabase();
  return db.transaction('r', db.notes, db.contents, async () => {
    const metas = await db.notes.toArray();
    const contents = await db.contents.toArray();
    const byId = new Map(contents.map((row) => [row.noteId, row.content]));
    return metas
      .sort((a, b) => a.tabId.localeCompare(b.tabId) || a.position - b.position)
      .map((meta) => ({ ...meta, content: byId.get(meta.id) ?? createEmptyDocument() }));
  });
}

export async function createNote(input: {
  tabId: string;
  title?: string;
  color?: string;
  content?: JSONContent;
}): Promise<Note> {
  const db = getDatabase();
  const now = Date.now();
  const content = input.content ?? createEmptyDocument();

  return db.transaction('rw', db.notes, db.contents, async () => {
    // New notes are appended, which keeps creation O(1) even with thousands of
    // notes in a tab (inserting at the top would renumber every row).
    const last = await tabRange(input.tabId).last();
    const meta: NoteMeta = {
      id: createId(),
      tabId: input.tabId,
      title: normalizeTitle(input.title, DEFAULT_NOTE_TITLE),
      color: normalizeColor(input.color, DEFAULT_NOTE_COLOR),
      plainText: extractPlainText(content),
      position: last ? last.position + 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.notes.add(meta);
    await db.contents.put({ noteId: meta.id, content });
    return { ...meta, content };
  });
}

/**
 * Applies a patch to one note, atomically across both tables.
 *
 * `expectedUpdatedAt` enables optimistic concurrency: when another view has
 * written to the note since this editing session read it, the write is refused
 * with `conflict` instead of silently overwriting. Pass `force` to win.
 */
export async function applyNotePatch(
  noteId: string,
  patch: NotePatch,
  options: { expectedUpdatedAt?: number | null; force?: boolean } = {},
): Promise<PatchResult> {
  const db = getDatabase();

  return db.transaction('rw', db.notes, db.contents, async () => {
    const current = await db.notes.get(noteId);
    if (!current) return { status: 'missing' as const };

    const { expectedUpdatedAt, force } = options;
    if (!force && expectedUpdatedAt != null && current.updatedAt > expectedUpdatedAt) {
      return { status: 'conflict' as const, currentUpdatedAt: current.updatedAt };
    }

    // Strictly increasing, so two writes inside the same millisecond still
    // produce distinct versions for conflict detection.
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1);

    const next: NoteMeta = {
      ...current,
      ...(patch.title !== undefined ? { title: normalizeTitle(patch.title, current.title) } : {}),
      ...(patch.color !== undefined ? { color: normalizeColor(patch.color, current.color) } : {}),
      ...(patch.tabId !== undefined ? { tabId: patch.tabId } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      ...(patch.plainText !== undefined ? { plainText: patch.plainText } : {}),
      updatedAt,
    };

    if (patch.content !== undefined && patch.plainText === undefined) {
      next.plainText = extractPlainText(patch.content);
    }

    await db.notes.put(next);
    if (patch.content !== undefined) {
      await db.contents.put({ noteId, content: patch.content });
    }
    return { status: 'saved' as const, updatedAt };
  });
}

/** Deletes a note and returns a snapshot so the action can be undone. */
export async function deleteNote(id: string): Promise<NoteSnapshot | undefined> {
  const db = getDatabase();
  return db.transaction('rw', db.notes, db.contents, async () => {
    const meta = await db.notes.get(id);
    if (!meta) return undefined;
    const content = (await db.contents.get(id))?.content ?? createEmptyDocument();
    await db.contents.delete(id);
    await db.notes.delete(id);
    return { meta, content };
  });
}

/**
 * Restores a snapshot produced by `deleteNote`.
 *
 * If the original tab is gone the note is placed in `fallbackTabId`, so undo
 * still works after the tab was deleted too.
 */
export async function restoreNote(
  snapshot: NoteSnapshot,
  fallbackTabId?: string,
): Promise<NoteMeta> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, db.notes, db.contents, async () => {
    const tabExists = (await db.tabs.get(snapshot.meta.tabId)) !== undefined;
    const tabId = tabExists ? snapshot.meta.tabId : (fallbackTabId ?? snapshot.meta.tabId);
    const meta: NoteMeta = { ...snapshot.meta, tabId };
    await db.notes.put(meta);
    await db.contents.put({ noteId: meta.id, content: snapshot.content });
    return meta;
  });
}

export async function duplicateNote(id: string): Promise<Note | undefined> {
  const db = getDatabase();
  return db.transaction('rw', db.notes, db.contents, async () => {
    const source = await db.notes.get(id);
    if (!source) return undefined;
    const content = (await db.contents.get(id))?.content ?? createEmptyDocument();
    const now = Date.now();
    const last = await tabRange(source.tabId).last();

    const copy: NoteMeta = {
      ...source,
      id: createId(),
      title: `${source.title} (copy)`.slice(0, 200),
      position: last ? last.position + 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.notes.add(copy);
    await db.contents.put({ noteId: copy.id, content });
    return { ...copy, content };
  });
}

/** Moves a note to the end of another tab. */
export async function moveNoteToTab(id: string, tabId: string): Promise<NoteMeta | undefined> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, db.notes, async () => {
    const note = await db.notes.get(id);
    if (!note) return undefined;
    if (note.tabId === tabId) return note;
    const targetTab = await db.tabs.get(tabId);
    if (!targetTab) return undefined;

    const last = await tabRange(tabId).last();
    const next: NoteMeta = {
      ...note,
      tabId,
      position: last ? last.position + 1 : 0,
      updatedAt: Math.max(Date.now(), note.updatedAt + 1),
    };
    await db.notes.put(next);
    return next;
  });
}

/** Moves a note one slot up (`-1`) or down (`1`) within its tab. */
export async function moveNoteWithinTab(id: string, delta: -1 | 1): Promise<boolean> {
  const db = getDatabase();
  return db.transaction('rw', db.notes, async () => {
    const note = await db.notes.get(id);
    if (!note) return false;

    const siblings = await tabRange(note.tabId).toArray();
    const index = siblings.findIndex((item) => item.id === id);
    const targetIndex = index + delta;
    if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) return false;

    const current = siblings[index];
    const target = siblings[targetIndex];
    // Swapping the stored position values reorders correctly even if the
    // sequence has gaps.
    await db.notes.bulkPut([
      { ...current, position: target.position },
      { ...target, position: current.position },
    ]);
    return true;
  });
}

/**
 * Substring search over note titles and plain text.
 *
 * Scoped to one tab this uses the `[tabId+position]` index; across all tabs it
 * scans note metadata, which stays responsive because documents live in a
 * separate table.
 */
export async function searchNotes(options: {
  query: string;
  scope: SearchScope;
  tabId?: string | null;
}): Promise<NoteMeta[]> {
  const needle = options.query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const matches = (note: NoteMeta): boolean =>
    note.title.toLowerCase().includes(needle) || note.plainText.toLowerCase().includes(needle);

  let results: NoteMeta[];
  if (options.scope === 'tab') {
    // Without a selected tab there is no scope to search: returning every note
    // here would silently widen a single-tab search to the whole database.
    if (!options.tabId) return [];
    results = (await listNotesByTab(options.tabId)).filter(matches);
  } else {
    results = await getDatabase().notes.filter(matches).toArray();
  }

  // Title matches first, then most recently updated.
  return results.sort((a, b) => {
    const aTitle = a.title.toLowerCase().includes(needle) ? 0 : 1;
    const bTitle = b.title.toLowerCase().includes(needle) ? 0 : 1;
    return aTitle - bTitle || b.updatedAt - a.updatedAt;
  });
}

function normalizeTitle(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : fallback;
}
