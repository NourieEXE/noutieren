import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  WorkspaceContext,
  type WorkspaceActions,
  type WorkspaceApi,
} from '../hooks/workspaceContext';
import { useToasts } from '../hooks/toastContext';
import type { AppPreferences, JSONContent, NoteMeta } from '../types';
import { getTab, listTabs, moveTab as moveTabRow, updateTab } from '../database/tabsRepository';
import {
  createNote as createNoteRow,
  deleteNote as deleteNoteRow,
  duplicateNote as duplicateNoteRow,
  getNote,
  listNotesByTab,
  moveNoteToTab as moveNoteToTabRow,
  moveNoteWithinTab,
  noteCountsByTab,
  restoreNote,
} from '../database/notesRepository';
import { createTab as createTabRow } from '../database/tabsRepository';
import {
  deleteTabEnsuringOne,
  resolveSelectedNoteId,
  resolveSelectedTabId,
} from '../services/workspaceService';
import { saveQueue } from '../services/saveQueue';
import { savePreferences } from '../services/preferences';
import { describeError, logError } from '../services/errors';

/**
 * Owns workspace state: live tab/note queries, the current selection, and every
 * mutation the UI can trigger.
 *
 * Two rules shape this file:
 *
 * 1. Note writes go through `saveQueue`, which keys pending work by note id.
 *    That is what makes rapid note switching safe.
 * 2. Selection changes flush the note being left before moving on.
 */
export function WorkspaceProvider({
  children,
  initialPreferences,
}: {
  children: ReactNode;
  initialPreferences: AppPreferences;
}) {
  const toasts = useToasts();
  const [preferences, setPreferences] = useState<AppPreferences>(initialPreferences);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(
    initialPreferences.selectedTabId,
  );
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    initialPreferences.selectedNoteId,
  );

  // Refs keep event handlers and debounced callbacks off stale closures. They
  // are synchronised after commit; the handlers that read them also write them,
  // so a selection change is never observed late.
  const selectedNoteIdRef = useRef(selectedNoteId);
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
    preferencesRef.current = preferences;
  });

  const [reloadKey, setReloadKey] = useState(0);

  const tabs = useLiveQuery(() => listTabs(), [reloadKey]);

  /**
   * Notes are returned together with the tab they were read for. A result for a
   * previous tab is treated as "still loading" so the UI never briefly shows
   * another tab's notes while the query catches up.
   */
  const notesResult = useLiveQuery(
    async () => ({
      tabId: selectedTabId,
      notes: selectedTabId ? await listNotesByTab(selectedTabId) : ([] as NoteMeta[]),
    }),
    [selectedTabId, reloadKey],
  );
  const notes = notesResult && notesResult.tabId === selectedTabId ? notesResult.notes : undefined;

  const noteCountsQuery = useLiveQuery(() => noteCountsByTab(), [reloadKey]);
  // Memoised so the fallback object does not change identity every render and
  // invalidate the context value below.
  const noteCounts = useMemo(() => noteCountsQuery ?? {}, [noteCountsQuery]);

  const loading = tabs === undefined || notes === undefined;

  /* ------------------------------------------------------------ selection */

  const persistSelection = useCallback((patch: Partial<AppPreferences>) => {
    void savePreferences(preferencesRef.current, patch).then((next) => {
      preferencesRef.current = next;
      setPreferences(next);
    });
  }, []);

  const selectNote = useCallback(
    (id: string | null) => {
      const previous = selectedNoteIdRef.current;
      if (previous && previous !== id) {
        // Cancel the debounce and write the note being left. Not awaited: the
        // patch already carries its own note id, so the write cannot land on
        // the note being opened.
        void saveQueue.flush(previous);
      }
      selectedNoteIdRef.current = id;
      setSelectedNoteId(id);
      persistSelection({ selectedNoteId: id });
    },
    [persistSelection],
  );

  const selectTab = useCallback(
    (id: string) => {
      const previous = selectedNoteIdRef.current;
      if (previous) void saveQueue.flush(previous);
      setSelectedTabId(id);
      // Clear the note so the editor does not render a note from the old tab
      // while the new tab's notes load; the repair effect picks the first note.
      selectedNoteIdRef.current = null;
      setSelectedNoteId(null);
      persistSelection({ selectedTabId: id, selectedNoteId: null });
    },
    [persistSelection],
  );

  const revealNote = useCallback(
    (tabId: string, noteId: string) => {
      const previous = selectedNoteIdRef.current;
      if (previous && previous !== noteId) void saveQueue.flush(previous);
      setSelectedTabId(tabId);
      selectedNoteIdRef.current = noteId;
      setSelectedNoteId(noteId);
      persistSelection({ selectedTabId: tabId, selectedNoteId: noteId });
    },
    [persistSelection],
  );

  /*
   * Repair a selection that points at something deleted.
   *
   * A selection missing from the live list is not proof it is gone: right after
   * creating a tab or note we select it optimistically, before the live query
   * has caught up. Repairing on that basis would bounce the user straight back
   * to the first item, so the database is consulted before giving up on an id.
   */
  useEffect(() => {
    if (!tabs) return undefined;

    if (selectedTabId && tabs.some((tab) => tab.id === selectedTabId)) return undefined;

    let cancelled = false;
    const repair = () => {
      const resolved = resolveSelectedTabId(tabs, null);
      if (cancelled || resolved === selectedTabId) return;
      setSelectedTabId(resolved);
      persistSelection({ selectedTabId: resolved });
    };

    if (!selectedTabId) {
      repair();
      return undefined;
    }

    void getTab(selectedTabId).then((found) => {
      // Still in the database: the list will include it on the next update.
      if (!found) repair();
    });

    return () => {
      cancelled = true;
    };
  }, [tabs, selectedTabId, persistSelection]);

  useEffect(() => {
    if (!notes) return undefined;

    if (selectedNoteId && notes.some((note) => note.id === selectedNoteId)) return undefined;

    let cancelled = false;
    const repair = () => {
      const resolved = resolveSelectedNoteId(notes, null);
      if (cancelled || resolved === selectedNoteId) return;
      selectedNoteIdRef.current = resolved;
      setSelectedNoteId(resolved);
      persistSelection({ selectedNoteId: resolved });
    };

    if (!selectedNoteId) {
      repair();
      return undefined;
    }

    void getNote(selectedNoteId).then((found) => {
      // A note that exists but sits in another tab is not this list's business;
      // only a note that is truly gone triggers a repair.
      if (!found) repair();
      else if (found.tabId !== selectedTabId) repair();
    });

    return () => {
      cancelled = true;
    };
  }, [notes, selectedNoteId, selectedTabId, persistSelection]);

  /* -------------------------------------------------------------- flushing */

  const flushSaves = useCallback(async () => {
    await saveQueue.flush();
  }, []);

  useEffect(() => {
    const flush = () => {
      void saveQueue.flush();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      // Unmount: write anything still queued.
      void saveQueue.flush();
    };
  }, []);

  /* ------------------------------------------------------------- conflicts */

  useEffect(
    () =>
      saveQueue.onConflict(({ noteId }) => {
        toasts.push({
          tone: 'error',
          duration: 0,
          message:
            'This note was changed in another window. Choose which version to keep — nothing has been overwritten.',
          action: {
            label: 'Keep my version',
            onAction: () => {
              void saveQueue.resolveConflict(noteId, 'keep-mine');
            },
          },
        });
      }),
    [toasts],
  );

  /* --------------------------------------------------------------- actions */

  const reportError = useCallback(
    (context: string, error: unknown) => {
      logError(context, error);
      toasts.push({ tone: 'error', message: describeError(error) });
    },
    [toasts],
  );

  const actions = useMemo<WorkspaceActions>(() => {
    const guard = async (context: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (error) {
        reportError(context, error);
      }
    };

    return {
      createTab: () =>
        guard('createTab', async () => {
          const tab = await createTabRow({ title: 'New tab' });
          selectTab(tab.id);
          toasts.push({ message: `Tab "${tab.title}" created.`, tone: 'success', duration: 3000 });
        }),

      renameTab: (id, title) =>
        guard('renameTab', async () => void (await updateTab(id, { title }))),

      recolorTab: (id, color) =>
        guard('recolorTab', async () => void (await updateTab(id, { color }))),

      moveTab: (id, delta) => guard('moveTab', async () => void (await moveTabRow(id, delta))),

      deleteTab: (id) =>
        guard('deleteTab', async () => {
          const tab = tabs?.find((candidate) => candidate.id === id);
          const { deletedNotes, replacementTab } = await deleteTabEnsuringOne(id);
          if (replacementTab) selectTab(replacementTab.id);
          toasts.push({
            message: `Deleted "${tab?.title ?? 'tab'}"${
              deletedNotes > 0 ? ` and ${deletedNotes} note${deletedNotes === 1 ? '' : 's'}` : ''
            }.`,
            tone: 'success',
          });
        }),

      createNote: () =>
        guard('createNote', async () => {
          if (!selectedTabId) return;
          const note = await createNoteRow({ tabId: selectedTabId });
          selectNote(note.id);
        }),

      renameNote: (id, title) => {
        saveQueue.schedule(id, { title });
      },

      recolorNote: (id, color) => {
        // Discrete change: queue it, then write immediately so the swatch and
        // the stored value never disagree.
        saveQueue.schedule(id, { color });
        void saveQueue.flush(id);
      },

      moveNote: (id, delta) =>
        guard('moveNote', async () => {
          await saveQueue.flush(id);
          await moveNoteWithinTab(id, delta);
        }),

      moveNoteToTab: (id, tabId) =>
        guard('moveNoteToTab', async () => {
          await saveQueue.flush(id);
          const moved = await moveNoteToTabRow(id, tabId);
          if (!moved) return;
          const target = tabs?.find((tab) => tab.id === tabId);
          toasts.push({
            message: `Moved to "${target?.title ?? 'tab'}".`,
            tone: 'success',
            duration: 4000,
          });
          // The note left the current tab; the repair effect selects a sibling.
          if (selectedNoteIdRef.current === id) selectNote(null);
        }),

      duplicateNote: (id) =>
        guard('duplicateNote', async () => {
          await saveQueue.flush(id);
          const copy = await duplicateNoteRow(id);
          if (copy) selectNote(copy.id);
        }),

      deleteNote: (id) =>
        guard('deleteNote', async () => {
          const list = notes ?? [];
          const index = list.findIndex((note) => note.id === id);
          const neighbour = list[index + 1] ?? list[index - 1] ?? null;

          const snapshot = await deleteNoteRow(id);
          saveQueue.discard(id);
          if (!snapshot) return;

          selectNote(neighbour ? neighbour.id : null);

          toasts.push({
            message: `Deleted "${snapshot.meta.title}".`,
            action: {
              label: 'Undo',
              onAction: () => {
                void (async () => {
                  try {
                    const fallback = selectedTabId ?? tabs?.[0]?.id;
                    const restored = await restoreNote(snapshot, fallback);
                    selectNote(restored.id);
                  } catch (error) {
                    reportError('restoreNote', error);
                  }
                })();
              },
            },
          });
        }),

      updateNoteContent: (id, content: JSONContent, plainText) => {
        saveQueue.schedule(id, { content, plainText });
      },

      refreshAfterBulkChange: () =>
        guard('refreshAfterBulkChange', async () => {
          setReloadKey((key) => key + 1);
          await Promise.resolve();
        }),
    };
  }, [notes, reportError, selectNote, selectTab, selectedTabId, tabs, toasts]);

  /* ------------------------------------------------------------ assembling */

  const updatePreferences = useCallback((patch: Partial<AppPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
    void savePreferences(preferencesRef.current, patch).then((next) => {
      preferencesRef.current = next;
    });
  }, []);

  const value = useMemo<WorkspaceApi>(() => {
    const tabList = tabs ?? [];
    const noteList = notes ?? [];
    return {
      loading,
      tabs: tabList,
      notes: noteList,
      noteCounts,
      totalNoteCount: Object.values(noteCounts).reduce((sum, count) => sum + count, 0),
      selectedTabId,
      selectedNoteId,
      selectedTab: tabList.find((tab) => tab.id === selectedTabId) ?? null,
      selectedNote: noteList.find((note) => note.id === selectedNoteId) ?? null,
      selectTab,
      selectNote,
      revealNote,
      preferences,
      updatePreferences,
      actions,
      flushSaves,
    };
  }, [
    actions,
    flushSaves,
    loading,
    noteCounts,
    notes,
    preferences,
    revealNote,
    selectNote,
    selectTab,
    selectedNoteId,
    selectedTabId,
    tabs,
    updatePreferences,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
