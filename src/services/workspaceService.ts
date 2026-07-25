import { getDatabase } from '../database/db';
import {
  DEFAULT_TAB_TITLE,
  countTabs,
  createTab,
  deleteTab,
  listTabs,
} from '../database/tabsRepository';
import {
  DEFAULT_NOTE_TITLE,
  createNote,
  listNotesByTab,
  searchNotes,
} from '../database/notesRepository';
import type { NoteMeta, NoteTab, SearchResult, SearchScope } from '../types';

/**
 * Workspace-level operations that span more than one repository, plus the pure
 * selection helpers the UI needs. Keeping them here means components never
 * coordinate multi-table writes themselves.
 */

/**
 * Creates the first-run tab and note if the database is empty.
 *
 * Runs inside a single transaction so two views opening at the same moment
 * cannot both seed.
 */
export async function ensureSeeded(): Promise<{ seeded: boolean }> {
  const db = getDatabase();
  return db.transaction('rw', db.tabs, db.notes, db.contents, async () => {
    if ((await db.tabs.count()) > 0) return { seeded: false };
    const tab = await createTab({ title: DEFAULT_TAB_TITLE });
    await createNote({ tabId: tab.id, title: DEFAULT_NOTE_TITLE });
    return { seeded: true };
  });
}

/**
 * Deletes a tab and guarantees at least one tab still exists afterwards, so the
 * user can never end up with an empty workspace.
 */
export async function deleteTabEnsuringOne(tabId: string): Promise<{
  deletedNotes: number;
  replacementTab: NoteTab | null;
}> {
  const { deletedNotes } = await deleteTab(tabId);
  if ((await countTabs()) > 0) return { deletedNotes, replacementTab: null };
  const replacementTab = await createTab({ title: DEFAULT_TAB_TITLE });
  return { deletedNotes, replacementTab };
}

/** Keeps a stored tab selection only if that tab still exists. */
export function resolveSelectedTabId(
  tabs: readonly NoteTab[],
  candidate: string | null,
): string | null {
  if (tabs.length === 0) return null;
  if (candidate && tabs.some((tab) => tab.id === candidate)) return candidate;
  return tabs[0].id;
}

/** Keeps a stored note selection only if that note is in the given list. */
export function resolveSelectedNoteId(
  notes: readonly NoteMeta[],
  candidate: string | null,
): string | null {
  if (notes.length === 0) return null;
  if (candidate && notes.some((note) => note.id === candidate)) return candidate;
  return notes[0].id;
}

/** Excerpt of `plainText` centred on the first match, for search results. */
export function buildSnippet(plainText: string, query: string, radius = 44): string {
  const collapsed = plainText.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return '';

  const needle = query.trim().toLowerCase();
  const index = needle.length > 0 ? collapsed.toLowerCase().indexOf(needle) : -1;
  if (index === -1) {
    return collapsed.length > radius * 2 ? `${collapsed.slice(0, radius * 2 - 1)}…` : collapsed;
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(collapsed.length, index + needle.length + radius);
  return `${start > 0 ? '…' : ''}${collapsed.slice(start, end)}${end < collapsed.length ? '…' : ''}`;
}

/**
 * Runs a search and decorates the hits with their tab and an excerpt.
 *
 * Search never leaves the device: it is a substring scan over locally stored
 * note metadata.
 */
export async function runSearch(options: {
  query: string;
  scope: SearchScope;
  tabId: string | null;
}): Promise<SearchResult[]> {
  const query = options.query.trim();
  if (query.length === 0) return [];

  const matches = await searchNotes({ query, scope: options.scope, tabId: options.tabId });
  if (matches.length === 0) return [];

  // Only look up tabs when results can span more than one.
  const tabsById = new Map<string, NoteTab>();
  if (options.scope === 'all') {
    for (const tab of await listTabs()) tabsById.set(tab.id, tab);
  }

  const needle = query.toLowerCase();
  return matches.map((note) => ({
    note,
    tab: tabsById.get(note.tabId),
    snippet: buildSnippet(note.plainText, query),
    matchedTitle: note.title.toLowerCase().includes(needle),
  }));
}

/** Note counts per tab, for the tab badges. */
export async function tabNoteCounts(tabs: readonly NoteTab[]): Promise<Record<string, number>> {
  const db = getDatabase();
  const entries = await Promise.all(
    tabs.map(
      async (tab) => [tab.id, await db.notes.where('tabId').equals(tab.id).count()] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** Convenience used after import/reset to land on a valid selection. */
export async function firstSelection(): Promise<{
  tabId: string | null;
  noteId: string | null;
}> {
  const tabs = await listTabs();
  const tabId = tabs[0]?.id ?? null;
  if (!tabId) return { tabId: null, noteId: null };
  const notes = await listNotesByTab(tabId);
  return { tabId, noteId: notes[0]?.id ?? null };
}
