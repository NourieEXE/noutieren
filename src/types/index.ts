import type { JSONContent } from '@tiptap/core';

export type { JSONContent };

/** A color-labeled tab. Tabs are ordered by `position` (ascending). */
export interface NoteTab {
  id: string;
  title: string;
  color: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Note metadata. Deliberately excludes the rich-text document: lists, previews
 * and search only need this row, so editor documents live in a separate table
 * and are loaded one at a time.
 */
export interface NoteMeta {
  id: string;
  tabId: string;
  title: string;
  color: string;
  /** Plain-text rendering of the document, used for search and previews. */
  plainText: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

/** The rich-text document for a note, stored separately from its metadata. */
export interface NoteContentRow {
  noteId: string;
  content: JSONContent;
}

/** A note with its document attached — the shape used by export/import. */
export interface Note extends NoteMeta {
  content: JSONContent;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppPreferences {
  selectedTabId: string | null;
  selectedNoteId: string | null;
  notesPanelCollapsed: boolean;
  theme: ThemePreference;
  /** Whether search covers every tab or only the selected one. */
  searchAllTabs: boolean;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface SearchResult {
  note: NoteMeta;
  tab: NoteTab | undefined;
  /** Short excerpt of `plainText` around the first match. */
  snippet: string;
  matchedTitle: boolean;
}

export type SearchScope = 'tab' | 'all';

/** Patch applied to a note by the autosave queue. */
export interface NotePatch {
  title?: string;
  color?: string;
  content?: JSONContent;
  plainText?: string;
  tabId?: string;
  position?: number;
}

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  application: string;
  formatVersion: number;
  exportedAt: number;
  schemaVersion: number;
  tabs: NoteTab[];
  notes: Note[];
  preferences: Partial<AppPreferences>;
}

export type ImportMode = 'replace' | 'merge';

export interface ImportSummary {
  mode: ImportMode;
  tabsImported: number;
  notesImported: number;
  tabsRenamedForCollision: number;
  notesReassigned: number;
  /** Non-fatal problems that were repaired rather than rejected. */
  repairs: string[];
}
