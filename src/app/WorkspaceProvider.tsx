import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  WorkspaceContext,
  type PinStatus,
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
import { getTeardownHandoff } from '../services/teardown';
import { savePreferences } from '../services/preferences';
import { describeError, logError } from '../services/errors';
import {
  canPromptForPermission,
  hasTabsPermission,
  requestTabsPermission,
} from '../services/activeTabUrl';
import {
  resolveNoteAfterPinChange,
  resolveTabAfterPinChange,
  selectVisible,
  type PinContext,
} from '../services/pinVisibility';
import { useActiveUrl } from '../hooks/useActiveUrl';
import { detectViewMode, openFullPageEditor } from '../services/webext';

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

  /* ------------------------------------------------------------ url pins */

  const { url: activeUrl, granted } = useActiveUrl();

  // The full-page view is itself a browser tab, so there is no "page next to
  // the sidebar" to pin against. Read once: the surface cannot change without
  // a fresh document.
  const [pinsInert] = useState(() => detectViewMode() === 'page');

  const pinContext = useMemo<PinContext>(
    () => ({
      activeUrl,
      granted,
      showHidden: preferences.showHiddenPins,
      inert: pinsInert,
    }),
    [activeUrl, granted, preferences.showHiddenPins, pinsInert],
  );

  /*
   * The tab actually shown, once pins are taken into account.
   *
   * Derived during render rather than written back into `selectedTabId`. Two
   * reasons, and the second is the one that matters:
   *
   * 1. Writing state from an effect that only observes other state costs a
   *    second render pass for nothing.
   * 2. `selectedTabId` is the user's *choice*, and it is persisted. Overwriting
   *    it because they happened to navigate would mean returning to the
   *    original page leaves them somewhere else. Deriving instead lets the
   *    choice survive: leave github.com and the pinned tab steps aside; come
   *    back and it returns, with nothing having been overwritten.
   *
   * Everything downstream — the notes query, the selection the UI reports —
   * follows this, not the stored id.
   */
  const effectiveTabId = useMemo(
    () =>
      tabs ? (resolveTabAfterPinChange(tabs, selectedTabId, pinContext) ?? selectedTabId) : null,
    [tabs, selectedTabId, pinContext],
  );

  /**
   * Notes are returned together with the tab they were read for. A result for a
   * previous tab is treated as "still loading" so the UI never briefly shows
   * another tab's notes while the query catches up.
   */
  const notesResult = useLiveQuery(
    async () => ({
      tabId: effectiveTabId,
      notes: effectiveTabId ? await listNotesByTab(effectiveTabId) : ([] as NoteMeta[]),
    }),
    [effectiveTabId, reloadKey],
  );
  const notes = notesResult && notesResult.tabId === effectiveTabId ? notesResult.notes : undefined;

  const noteCountsQuery = useLiveQuery(() => noteCountsByTab(), [reloadKey]);
  // Memoised so the fallback object does not change identity every render and
  // invalidate the context value below.
  const noteCounts = useMemo(() => noteCountsQuery ?? {}, [noteCountsQuery]);

  const loading = tabs === undefined || notes === undefined;

  /*
   * The two items a pin must not hide, because they were explicitly asked for.
   *
   * `revealed` is set only by `revealNote`, which is how a search result opens.
   * Search deliberately looks past pins so notes never become unfindable, so
   * opening a result has to actually open it. Everything else — including the
   * ordinary selection — is filtered normally, which is what makes a pinned
   * note disappear when you navigate away from its page.
   */
  const [revealed, setRevealed] = useState<{ tabId: string; noteId: string } | null>(null);

  const visible = useMemo(
    () =>
      selectVisible(
        tabs ?? [],
        notes ?? [],
        revealed?.tabId ?? null,
        revealed?.noteId ?? null,
        pinContext,
      ),
    [tabs, notes, revealed, pinContext],
  );

  /*
   * The note actually shown, once pins are taken into account.
   *
   * Derived exactly like `effectiveTabId`, and for the same reason: the stored
   * `selectedNoteId` is the user's choice and is left untouched, so leaving the
   * pinned page steps off the note and returning to it steps back on.
   */
  const effectiveNoteId = useMemo(() => {
    if (revealed?.noteId && revealed.noteId === selectedNoteId) return selectedNoteId;
    return resolveNoteAfterPinChange(notes ?? [], selectedNoteId, pinContext) ?? selectedNoteId;
  }, [notes, selectedNoteId, pinContext, revealed]);

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
      // An ordinary click is not a reveal, so any standing exemption ends here.
      setRevealed(null);
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
      setRevealed(null);
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
      // Exempt this one item from pins until the next ordinary selection: the
      // user asked for it by name, and search sees past pins by design.
      setRevealed({ tabId, noteId });
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
      else if (found.tabId !== effectiveTabId) repair();
    });

    return () => {
      cancelled = true;
    };
  }, [notes, selectedNoteId, effectiveTabId, persistSelection]);

  /*
   * Write out a note a pin has just stepped off.
   *
   * Stepping off happens without `selectNote`, which is what normally flushes
   * the note being left, so nothing else would do it here. The queue would
   * still write on its own debounce, but the editor for that note has already
   * unmounted by then — this closes the window rather than relying on it. No
   * state is set, so this is a genuine external-system effect.
   */
  const flushedNoteRef = useRef(effectiveNoteId);
  useEffect(() => {
    const previous = flushedNoteRef.current;
    flushedNoteRef.current = effectiveNoteId;
    if (previous && previous !== effectiveNoteId) void saveQueue.flush(previous);
  }, [effectiveNoteId]);

  /* -------------------------------------------------------------- flushing */

  const flushSaves = useCallback(async () => {
    await saveQueue.flush();
  }, []);

  useEffect(() => {
    // A soft signal: the document survives being hidden, so writing in place is
    // both correct and cheap.
    const flush = () => {
      void saveQueue.flush();
    };

    // The last code that may ever run in this document. Where a handoff is
    // installed — a Chrome toolbar popup, which is torn down the instant it
    // loses focus — the queue is given away instead of written here, because a
    // transaction opened now would die with the connection. Taking the snapshot
    // empties the queue, so `pagehide` followed by `beforeunload` hands off once
    // and the second call finds nothing.
    const teardown = () => {
      const handoff = getTeardownHandoff();
      if (!handoff) {
        void saveQueue.flush();
        return;
      }
      const writes = saveQueue.takePendingSnapshot();
      if (writes.length > 0) handoff(writes);
    };

    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', teardown);
    window.addEventListener('beforeunload', teardown);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', teardown);
      window.removeEventListener('beforeunload', teardown);
      // Unmount: the document is still alive here, so write in place.
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

      /*
       * Saving a pin never asks for anything.
       *
       * Storing the patterns and holding the permission are separate concerns:
       * a pin is inert without the permission but perfectly valid, so writing
       * it costs nothing and refusing to write it would discard what the user
       * typed. The prompt is `requestPinPermission`, raised from a control that
       * says what it is for.
       */
      pinTab: (id, patterns) =>
        guard('pinTab', async () => void (await updateTab(id, { urlPatterns: patterns }))),

      pinNote: (id, patterns) =>
        guard('pinNote', async () => {
          saveQueue.schedule(id, { urlPatterns: patterns });
          await saveQueue.flush(id);
        }),

      requestPinPermission: async () => {
        if (await hasTabsPermission()) return 'granted';

        // Chrome's popup cannot raise the dialog at all — see
        // `canPromptForPermission`. Hand the job to the full-page view, which
        // is an ordinary tab, rather than firing a request that cannot resolve.
        if (!canPromptForPermission(detectViewMode())) {
          // Flagged, so the tab that opens leads with the request rather than
          // dropping the user into the editor with no idea why it appeared.
          await openFullPageEditor({ forPinGrant: true });
          return 'elsewhere';
        }

        return (await requestTabsPermission()) ? 'granted' : 'denied';
      },

      createNote: () =>
        guard('createNote', async () => {
          // The tab on screen, not the stored choice: a new note belongs where
          // the user is looking.
          if (!effectiveTabId) return;
          const note = await createNoteRow({ tabId: effectiveTabId });
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
          // The visible list, so the note selected after a delete is one the
          // user can actually see rather than something a pin is hiding.
          const list = visible.notes;
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
                    const fallback = effectiveTabId ?? tabs?.[0]?.id;
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
  }, [effectiveTabId, reportError, selectNote, selectTab, tabs, toasts, visible.notes]);

  /* ------------------------------------------------------------ assembling */

  const updatePreferences = useCallback((patch: Partial<AppPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
    void savePreferences(preferencesRef.current, patch).then((next) => {
      preferencesRef.current = next;
    });
  }, []);

  const setShowHiddenPins = useCallback(
    (value: boolean) => {
      updatePreferences({ showHiddenPins: value });
    },
    [updatePreferences],
  );

  const value = useMemo<WorkspaceApi>(() => {
    const tabList = visible.tabs;
    const noteList = visible.notes;
    const pinStatus: PinStatus = {
      activeUrl,
      granted,
      showHidden: preferences.showHiddenPins,
      inert: pinsInert,
      hiddenTabCount: visible.hiddenTabCount,
      hiddenNoteCount: visible.hiddenNoteCount,
    };
    return {
      loading,
      tabs: tabList,
      notes: noteList,
      allTabs: tabs ?? [],
      noteCounts,
      totalNoteCount: Object.values(noteCounts).reduce((sum, count) => sum + count, 0),
      pinStatus,
      setShowHiddenPins,
      // The tab on screen. A pin can make this differ from the stored choice,
      // which is intentionally left alone so it can be returned to.
      selectedTabId: effectiveTabId,
      // The note on screen, for the same reason and left alone the same way.
      selectedNoteId: effectiveNoteId,
      selectedTab: tabList.find((tab) => tab.id === effectiveTabId) ?? null,
      selectedNote: noteList.find((note) => note.id === effectiveNoteId) ?? null,
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
    activeUrl,
    effectiveNoteId,
    effectiveTabId,
    flushSaves,
    granted,
    loading,
    noteCounts,
    pinsInert,
    preferences,
    revealNote,
    selectNote,
    selectTab,
    setShowHiddenPins,
    tabs,
    updatePreferences,
    visible,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
