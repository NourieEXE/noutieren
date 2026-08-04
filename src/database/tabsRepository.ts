import { getDatabase } from './db';
import type { NoteTab } from '../types';
import { createId } from '../utils/id';
import { DEFAULT_TAB_COLOR, normalizeColor } from '../utils/colors';
import { sanitizePatternList } from '../utils/matchPattern';

/**
 * All tab reads and writes. Components never touch Dexie directly.
 *
 * Ordering uses an integer `position`. Positions are renumbered to a dense
 * 0..n-1 sequence after any structural change so the values stay small and
 * comparisons stay obvious.
 */

export const DEFAULT_TAB_TITLE = 'General';

export async function listTabs(): Promise<NoteTab[]> {
  return getDatabase().tabs.orderBy('position').toArray();
}

export async function getTab(id: string): Promise<NoteTab | undefined> {
  return getDatabase().tabs.get(id);
}

export async function countTabs(): Promise<number> {
  return getDatabase().tabs.count();
}

export async function createTab(
  input: { title?: string; color?: string; urlPatterns?: string[] } = {},
): Promise<NoteTab> {
  const db = getDatabase();
  const now = Date.now();

  return db.transaction('rw', db.tabs, async () => {
    const last = await db.tabs.orderBy('position').last();
    const patterns = sanitizePatternList(input.urlPatterns);
    const tab: NoteTab = {
      id: createId(),
      title: normalizeTitle(input.title, DEFAULT_TAB_TITLE),
      color: normalizeColor(input.color, DEFAULT_TAB_COLOR),
      position: last ? last.position + 1 : 0,
      createdAt: now,
      updatedAt: now,
      // Omitted rather than stored empty, so an unpinned tab is one shape.
      ...(patterns.length > 0 ? { urlPatterns: patterns } : {}),
    };
    await db.tabs.add(tab);
    return tab;
  });
}

export async function updateTab(
  id: string,
  patch: { title?: string; color?: string; urlPatterns?: string[] },
): Promise<NoteTab | undefined> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, async () => {
    const current = await db.tabs.get(id);
    if (!current) return undefined;

    const next: NoteTab = {
      ...current,
      ...(patch.title !== undefined ? { title: normalizeTitle(patch.title, current.title) } : {}),
      ...(patch.color !== undefined ? { color: normalizeColor(patch.color, current.color) } : {}),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    };

    // Assigned outside the spread so clearing a pin deletes the key instead of
    // leaving `urlPatterns: []` behind, which would then have to be treated as
    // equivalent to absent everywhere else.
    if (patch.urlPatterns !== undefined) {
      const patterns = sanitizePatternList(patch.urlPatterns);
      if (patterns.length > 0) next.urlPatterns = patterns;
      else delete next.urlPatterns;
    }

    await db.tabs.put(next);
    return next;
  });
}

/**
 * Deletes a tab together with every note it contains.
 *
 * Returns the number of deleted notes so the caller can report it; the
 * confirmation prompt is the caller's responsibility.
 */
export async function deleteTab(id: string): Promise<{ deletedNotes: number }> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, db.notes, db.contents, async () => {
    const noteIds = await db.notes.where('tabId').equals(id).primaryKeys();
    await db.contents.bulkDelete(noteIds);
    await db.notes.bulkDelete(noteIds);
    await db.tabs.delete(id);
    await renumberTabsWithin(db);
    return { deletedNotes: noteIds.length };
  });
}

/** Moves a tab one slot left (`-1`) or right (`1`). */
export async function moveTab(id: string, delta: -1 | 1): Promise<boolean> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, async () => {
    const tabs = await db.tabs.orderBy('position').toArray();
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return false;

    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= tabs.length) return false;

    const current = tabs[index];
    const target = tabs[targetIndex];
    const now = Date.now();
    await db.tabs.bulkPut([
      { ...current, position: target.position, updatedAt: now },
      { ...target, position: current.position, updatedAt: now },
    ]);
    return true;
  });
}

/** Moves a tab to an absolute index, used by drag-free reordering and import. */
export async function moveTabToIndex(id: string, index: number): Promise<boolean> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, async () => {
    const tabs = await db.tabs.orderBy('position').toArray();
    const from = tabs.findIndex((tab) => tab.id === id);
    if (from === -1) return false;

    const clamped = Math.min(Math.max(index, 0), tabs.length - 1);
    if (clamped === from) return false;

    const [moved] = tabs.splice(from, 1);
    tabs.splice(clamped, 0, moved);
    const now = Date.now();
    await db.tabs.bulkPut(tabs.map((tab, i) => ({ ...tab, position: i, updatedAt: now })));
    return true;
  });
}

function normalizeTitle(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : fallback;
}

async function renumberTabsWithin(db: ReturnType<typeof getDatabase>): Promise<void> {
  const tabs = await db.tabs.orderBy('position').toArray();
  const changed = tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ tab, index }) => tab.position !== index)
    .map(({ tab, index }) => ({ ...tab, position: index }));
  if (changed.length > 0) await db.tabs.bulkPut(changed);
}
