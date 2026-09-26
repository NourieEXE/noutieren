import Dexie from 'dexie';
import { getDatabase } from './db';
import type { NoteMeta, NoteTab, TrashEntry } from '../types';
import { createEmptyDocument } from '../editor/document';
import { createId } from '../utils/id';
import { DEFAULT_TAB_COLOR } from '../utils/colors';

/** "Recently deleted": notes wait here this long before they are gone for good. */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Moves notes into the trash with their documents and a copy of their tab.
 * Call inside a transaction over tabs, notes, contents and trash, and before
 * deleting the tab itself.
 */
export async function moveNotesToTrash(
  metas: readonly NoteMeta[],
  deletedAt = Date.now(),
): Promise<TrashEntry[]> {
  if (metas.length === 0) return [];
  const db = getDatabase();
  const ids = metas.map((meta) => meta.id);
  const contents = await db.contents.bulkGet(ids);
  const tabs = await db.tabs.bulkGet([...new Set(metas.map((meta) => meta.tabId))]);
  const tabsById = new Map<string, NoteTab>();
  for (const tab of tabs) if (tab) tabsById.set(tab.id, tab);

  const entries = metas.map((meta, index) => ({
    noteId: meta.id,
    meta,
    content: contents[index]?.content ?? createEmptyDocument(),
    tab: tabsById.get(meta.tabId) ?? null,
    deletedAt,
  }));
  await db.trash.bulkPut(entries);
  await db.contents.bulkDelete(ids);
  await db.notes.bulkDelete(ids);
  return entries;
}

/** Newest first. */
export async function listTrash(): Promise<TrashEntry[]> {
  return getDatabase().trash.orderBy('deletedAt').reverse().toArray();
}

/**
 * Puts a deleted note back. If its tab is gone too, the tab comes back with it;
 * if its old slot has been taken, it goes to the end of the tab.
 */
export async function restoreFromTrash(noteId: string): Promise<NoteMeta | undefined> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, db.notes, db.contents, db.trash, async () => {
    const entry = await db.trash.get(noteId);
    if (!entry) return undefined;

    const tabId = await restoreTarget(entry);
    const siblings = await db.notes
      .where('[tabId+position]')
      .between([tabId, Dexie.minKey], [tabId, Dexie.maxKey])
      .toArray();
    const slotTaken = siblings.some((note) => note.position === entry.meta.position);
    const position = slotTaken
      ? siblings.reduce((max, note) => Math.max(max, note.position + 1), 0)
      : entry.meta.position;
    // Only an import can have reused the id since; keep both notes.
    const id = (await db.notes.get(noteId)) ? createId() : noteId;

    const meta: NoteMeta = { ...entry.meta, id, tabId, position };
    // A reminder that came due while the note was deleted is not shown late.
    if (meta.remindAt !== undefined && meta.remindAt <= Date.now()) delete meta.remindAt;
    await db.notes.put(meta);
    await db.contents.put({ noteId: id, content: entry.content });
    await db.trash.delete(noteId);
    return meta;
  });
}

async function restoreTarget(entry: TrashEntry): Promise<string> {
  const db = getDatabase();
  if (await db.tabs.get(entry.meta.tabId)) return entry.meta.tabId;

  const last = await db.tabs.orderBy('position').last();
  const position = last ? last.position + 1 : 0;
  if (entry.tab) {
    await db.tabs.put({ ...entry.tab, position });
    return entry.tab.id;
  }
  if (last) return (await db.tabs.orderBy('position').first())!.id;

  const now = Date.now();
  const id = createId();
  await db.tabs.add({
    id,
    title: 'Restored',
    color: DEFAULT_TAB_COLOR,
    position,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function deleteForever(noteId: string): Promise<void> {
  await getDatabase().trash.delete(noteId);
}

export async function emptyTrash(): Promise<void> {
  await getDatabase().trash.clear();
}

export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  return getDatabase()
    .trash.where('deletedAt')
    .below(now - TRASH_RETENTION_DAYS * DAY_MS)
    .delete();
}
