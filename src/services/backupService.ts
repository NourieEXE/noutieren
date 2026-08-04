import { getDatabase } from '../database/db';
import { SCHEMA_VERSION } from '../database/db';
import { listTabs } from '../database/tabsRepository';
import { listAllNotesWithContent } from '../database/notesRepository';
import { createEmptyDocument, extractPlainText } from '../editor/document';
import { DocumentTooLargeError, looksLikeDocument, sanitizeDocument } from '../editor/sanitize';
import {
  DEFAULT_NOTE_COLOR,
  DEFAULT_TAB_COLOR,
  isValidColor,
  normalizeColor,
} from '../utils/colors';
import { createId, isValidId } from '../utils/id';
import { sanitizePatternList } from '../utils/matchPattern';
import { isValidTimestamp, isoDateStamp } from '../utils/time';
import { BACKUP_FORMAT_VERSION } from '../types';
import type {
  AppPreferences,
  BackupFile,
  ImportMode,
  ImportSummary,
  Note,
  NoteTab,
} from '../types';
import { AppError } from './errors';
import { DEFAULT_PREFERENCES, sanitizePreferences } from './preferences';
import { ensureSeeded } from './workspaceService';

/**
 * Export, import and reset.
 *
 * Import treats the file as hostile data: it is parsed, structurally
 * validated, repaired where repair is unambiguous, and every rich-text document
 * is rebuilt from an allowlist before a single row is written. Nothing from a
 * file is ever executed.
 */

export const APPLICATION_NAME = 'Noutieren';

export class ImportValidationError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImportValidationError';
  }
}

/** A validated, normalized backup ready to be written. */
export interface ParsedBackup extends BackupFile {
  /** Problems that were fixed rather than rejected, for reporting. */
  repairs: string[];
}

/* ------------------------------------------------------------------ export */

export async function createBackup(preferences?: AppPreferences): Promise<BackupFile> {
  const [tabs, notes] = await Promise.all([listTabs(), listAllNotesWithContent()]);
  return {
    application: APPLICATION_NAME,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
    tabs,
    notes,
    preferences: preferences ?? { ...DEFAULT_PREFERENCES },
  };
}

/** Human-readable JSON, so a backup can be inspected in any text editor. */
export function serializeBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function backupFilename(date: Date = new Date(), suffix = ''): string {
  return `noutieren-backup-${isoDateStamp(date)}${suffix}.json`;
}

/* ------------------------------------------------------------------ import */

interface TabDraft extends NoteTab {
  originalId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeText(value: unknown, fallback: string, maxLength = 200): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizePositionValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Parses and validates a backup file.
 *
 * @throws {ImportValidationError} for problems that cannot be repaired without
 * guessing at the user's data.
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ImportValidationError(
      'That file is not valid JSON. Choose a backup exported by Noutieren.',
      { cause: error },
    );
  }

  const root = asRecord(raw);
  if (!root) {
    throw new ImportValidationError('That file does not contain a Noutieren backup object.');
  }

  const formatVersion = root.formatVersion;
  if (typeof formatVersion !== 'number' || !Number.isFinite(formatVersion)) {
    throw new ImportValidationError(
      'That file is missing a backup format version, so it cannot be read safely.',
    );
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    throw new ImportValidationError(
      `That backup uses format version ${formatVersion}, which is newer than this extension supports (${BACKUP_FORMAT_VERSION}). Update Noutieren first.`,
    );
  }
  if (!Array.isArray(root.tabs)) {
    throw new ImportValidationError('That backup is missing its list of tabs.');
  }
  if (!Array.isArray(root.notes)) {
    throw new ImportValidationError('That backup is missing its list of notes.');
  }
  if (root.tabs.length === 0 && root.notes.length === 0) {
    throw new ImportValidationError('That backup contains no tabs and no notes.');
  }

  const repairs: string[] = [];
  const now = Date.now();

  // --- tabs ---------------------------------------------------------------
  const seenTabIds = new Set<string>();
  const tabDrafts: TabDraft[] = [];

  root.tabs.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      repairs.push(`Skipped tab ${index + 1}: not an object.`);
      return;
    }

    const originalId = isValidId(record.id) ? record.id : createId();
    if (!isValidId(record.id))
      repairs.push(`Tab ${index + 1} had an invalid id, which was replaced.`);

    let id = originalId;
    if (seenTabIds.has(id)) {
      id = createId();
      repairs.push(
        `Tab "${normalizeText(record.title, 'Untitled')}" had a duplicate id inside the file.`,
      );
    }
    seenTabIds.add(id);

    if (record.color !== undefined && !isValidColor(record.color)) {
      repairs.push(`Tab "${normalizeText(record.title, 'Untitled')}" had an invalid color.`);
    }

    const tabPins = sanitizePatternList(record.urlPatterns);
    if (Array.isArray(record.urlPatterns) && tabPins.length < record.urlPatterns.length) {
      repairs.push(
        `Tab "${normalizeText(record.title, 'Untitled')}" had URL pins that could not be read, which were dropped.`,
      );
    }

    tabDrafts.push({
      id,
      originalId,
      title: normalizeText(record.title, 'Untitled tab'),
      color: normalizeColor(record.color, DEFAULT_TAB_COLOR),
      position: normalizePositionValue(record.position, index),
      createdAt: isValidTimestamp(record.createdAt) ? record.createdAt : now,
      updatedAt: isValidTimestamp(record.updatedAt) ? record.updatedAt : now,
      ...(tabPins.length > 0 ? { urlPatterns: tabPins } : {}),
    });
  });

  tabDrafts.sort((a, b) => a.position - b.position);
  tabDrafts.forEach((tab, index) => {
    tab.position = index;
  });

  // Map original ids (and the file's duplicates) onto final tab ids.
  const tabIdMap = new Map<string, string>();
  for (const tab of tabDrafts) {
    if (!tabIdMap.has(tab.originalId)) tabIdMap.set(tab.originalId, tab.id);
  }

  if (tabDrafts.length === 0) {
    const fallback: TabDraft = {
      id: createId(),
      originalId: '',
      title: 'Imported',
      color: DEFAULT_TAB_COLOR,
      position: 0,
      createdAt: now,
      updatedAt: now,
    };
    tabDrafts.push(fallback);
    repairs.push('The backup had no usable tabs, so an "Imported" tab was created.');
  }

  // --- notes --------------------------------------------------------------
  const seenNoteIds = new Set<string>();
  const notes: Note[] = [];

  root.notes.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      repairs.push(`Skipped note ${index + 1}: not an object.`);
      return;
    }

    let id = isValidId(record.id) ? record.id : createId();
    if (!isValidId(record.id))
      repairs.push(`Note ${index + 1} had an invalid id, which was replaced.`);
    if (seenNoteIds.has(id)) {
      id = createId();
      repairs.push(
        `Note "${normalizeText(record.title, 'Untitled')}" had a duplicate id inside the file.`,
      );
    }
    seenNoteIds.add(id);

    // Repair dangling tab references rather than dropping the note.
    const referenced = isValidId(record.tabId) ? tabIdMap.get(record.tabId) : undefined;
    const tabId = referenced ?? tabDrafts[0].id;
    if (!referenced) {
      repairs.push(
        `Note "${normalizeText(record.title, 'Untitled')}" referenced a missing tab and was moved to "${tabDrafts[0].title}".`,
      );
    }

    let content = createEmptyDocument();
    if (looksLikeDocument(record.content)) {
      try {
        content = sanitizeDocument(record.content);
      } catch (error) {
        if (error instanceof DocumentTooLargeError) {
          throw new ImportValidationError(
            `Note "${normalizeText(record.title, 'Untitled')}" is implausibly large and was not imported.`,
            { cause: error },
          );
        }
        throw error;
      }
    } else if (record.content !== undefined) {
      repairs.push(
        `Note "${normalizeText(record.title, 'Untitled')}" had unreadable content, which was replaced with an empty note.`,
      );
    }

    if (record.color !== undefined && !isValidColor(record.color)) {
      repairs.push(`Note "${normalizeText(record.title, 'Untitled')}" had an invalid color.`);
    }

    const notePins = sanitizePatternList(record.urlPatterns);
    if (Array.isArray(record.urlPatterns) && notePins.length < record.urlPatterns.length) {
      repairs.push(
        `Note "${normalizeText(record.title, 'Untitled')}" had URL pins that could not be read, which were dropped.`,
      );
    }

    notes.push({
      id,
      tabId,
      title: normalizeText(record.title, 'Untitled note'),
      color: normalizeColor(record.color, DEFAULT_NOTE_COLOR),
      ...(notePins.length > 0 ? { urlPatterns: notePins } : {}),
      // Regenerated from the sanitized document — never trusted from the file,
      // so search can't be poisoned with text the note does not contain.
      plainText: extractPlainText(content),
      position: normalizePositionValue(record.position, index),
      createdAt: isValidTimestamp(record.createdAt) ? record.createdAt : now,
      updatedAt: isValidTimestamp(record.updatedAt) ? record.updatedAt : now,
      content,
    });
  });

  // Dense per-tab positions.
  const byTab = new Map<string, Note[]>();
  for (const note of notes) {
    const list = byTab.get(note.tabId) ?? [];
    list.push(note);
    byTab.set(note.tabId, list);
  }
  for (const list of byTab.values()) {
    list.sort((a, b) => a.position - b.position);
    list.forEach((note, index) => {
      note.position = index;
    });
  }

  // --- preferences --------------------------------------------------------
  const preferences = sanitizePreferences(root.preferences);
  const tabIds = new Set(tabDrafts.map((tab) => tab.id));
  const noteIds = new Set(notes.map((note) => note.id));
  if (preferences.selectedTabId && !tabIds.has(preferences.selectedTabId)) {
    preferences.selectedTabId = null;
  }
  if (preferences.selectedNoteId && !noteIds.has(preferences.selectedNoteId)) {
    preferences.selectedNoteId = null;
  }

  const tabs: NoteTab[] = tabDrafts.map(({ originalId: _originalId, ...tab }) => tab);

  return {
    application: normalizeText(root.application, APPLICATION_NAME, 100),
    formatVersion,
    exportedAt: isValidTimestamp(root.exportedAt) ? root.exportedAt : now,
    schemaVersion:
      typeof root.schemaVersion === 'number' && Number.isFinite(root.schemaVersion)
        ? root.schemaVersion
        : SCHEMA_VERSION,
    tabs,
    notes,
    preferences,
    repairs,
  };
}

/** Replaces everything, or merges alongside the current data. */
export async function importBackup(backup: ParsedBackup, mode: ImportMode): Promise<ImportSummary> {
  return mode === 'replace' ? replaceAll(backup) : mergeInto(backup);
}

async function replaceAll(backup: ParsedBackup): Promise<ImportSummary> {
  const db = getDatabase();
  await db.transaction('rw', db.tabs, db.notes, db.contents, async () => {
    await db.contents.clear();
    await db.notes.clear();
    await db.tabs.clear();
    await db.tabs.bulkPut(backup.tabs);
    await db.notes.bulkPut(backup.notes.map(({ content: _content, ...meta }) => meta));
    await db.contents.bulkPut(
      backup.notes.map((note) => ({ noteId: note.id, content: note.content })),
    );
  });

  return {
    mode: 'replace',
    tabsImported: backup.tabs.length,
    notesImported: backup.notes.length,
    tabsRenamedForCollision: 0,
    notesReassigned: 0,
    repairs: backup.repairs,
  };
}

async function mergeInto(backup: ParsedBackup): Promise<ImportSummary> {
  const db = getDatabase();

  return db.transaction('rw', db.tabs, db.notes, db.contents, async () => {
    const existingTabs = await db.tabs.toArray();
    const existingTabIds = new Set(existingTabs.map((tab) => tab.id));
    const existingTitles = new Set(existingTabs.map((tab) => tab.title.toLowerCase()));
    const existingNoteIds = new Set((await db.notes.toArray()).map((note) => note.id));
    const basePosition = existingTabs.reduce((max, tab) => Math.max(max, tab.position + 1), 0);

    const repairs = [...backup.repairs];
    let tabsRenamedForCollision = 0;
    let notesReassigned = 0;

    // Fresh ids for any tab that collides with existing data, so nothing is
    // overwritten, and remember the mapping to repair note references.
    const tabIdMap = new Map<string, string>();
    const mergedTabs: NoteTab[] = backup.tabs.map((tab, index) => {
      const id = existingTabIds.has(tab.id) ? createId() : tab.id;
      if (id !== tab.id)
        repairs.push(`Imported tab "${tab.title}" was given a new id to avoid a collision.`);
      tabIdMap.set(tab.id, id);

      let title = tab.title;
      if (existingTitles.has(title.toLowerCase())) {
        title = `${title} (imported)`.slice(0, 200);
        tabsRenamedForCollision += 1;
      }
      existingTitles.add(title.toLowerCase());

      return { ...tab, id, title, position: basePosition + index };
    });

    // Per-tab append offsets for merged notes.
    const tailPositions = new Map<string, number>();
    for (const tab of mergedTabs) tailPositions.set(tab.id, 0);
    for (const existing of await db.notes.toArray()) {
      const current = tailPositions.get(existing.tabId);
      if (current !== undefined) {
        tailPositions.set(existing.tabId, Math.max(current, existing.position + 1));
      }
    }

    const mergedNotes: Note[] = backup.notes.map((note) => {
      const id = existingNoteIds.has(note.id) ? createId() : note.id;
      if (id !== note.id) notesReassigned += 1;
      const tabId = tabIdMap.get(note.tabId) ?? mergedTabs[0].id;
      const position = tailPositions.get(tabId) ?? 0;
      tailPositions.set(tabId, position + 1);
      return { ...note, id, tabId, position };
    });

    await db.tabs.bulkPut(mergedTabs);
    await db.notes.bulkPut(mergedNotes.map(({ content: _content, ...meta }) => meta));
    await db.contents.bulkPut(
      mergedNotes.map((note) => ({ noteId: note.id, content: note.content })),
    );

    return {
      mode: 'merge' as const,
      tabsImported: mergedTabs.length,
      notesImported: mergedNotes.length,
      tabsRenamedForCollision,
      notesReassigned,
      repairs,
    };
  });
}

/**
 * Imports after handing the caller a safety copy of the current data.
 *
 * The safety backup is produced *before* anything is written, and only for
 * `replace`, which is the destructive mode.
 */
export async function importWithSafetyBackup(
  backup: ParsedBackup,
  mode: ImportMode,
  onSafetyBackup: (safety: BackupFile) => void,
  preferences?: AppPreferences,
): Promise<ImportSummary> {
  if (mode === 'replace') {
    const existing = await createBackup(preferences);
    if (existing.tabs.length > 0 || existing.notes.length > 0) onSafetyBackup(existing);
  }
  return importBackup(backup, mode);
}

/** Deletes everything and recreates the default tab and note. */
export async function resetAllData(): Promise<void> {
  const db = getDatabase();
  await db.transaction('rw', db.tabs, db.notes, db.contents, async () => {
    await db.contents.clear();
    await db.notes.clear();
    await db.tabs.clear();
  });
  await ensureSeeded();
}
