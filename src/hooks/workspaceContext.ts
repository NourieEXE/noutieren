import { createContext, useContext } from 'react';
import type { AppPreferences, JSONContent, NoteMeta, NoteTab } from '../types';

export interface WorkspaceActions {
  createTab: () => Promise<void>;
  renameTab: (id: string, title: string) => Promise<void>;
  recolorTab: (id: string, color: string) => Promise<void>;
  moveTab: (id: string, delta: -1 | 1) => Promise<void>;
  deleteTab: (id: string) => Promise<void>;

  /**
   * Sets or clears a tab's URL pin. An empty list clears it.
   *
   * Always saves. A pin is data, and it is inert but harmless without the
   * `tabs` permission, so refusing to store one would throw away what the user
   * typed to no benefit — they would have to type it again after granting.
   * Whether it is *active* is `pinStatus.granted`, reported separately.
   */
  pinTab: (id: string, patterns: string[]) => Promise<void>;
  /** The same, for one note. */
  pinNote: (id: string, patterns: string[]) => Promise<void>;

  /**
   * Asks for the permission that makes pins take effect.
   *
   * `'elsewhere'` means this surface cannot raise the dialog — Chrome's toolbar
   * popup — and the full-page view has been opened to ask there instead.
   */
  requestPinPermission: () => Promise<'granted' | 'denied' | 'elsewhere'>;

  createNote: () => Promise<void>;
  /** Debounced through the autosave queue. */
  renameNote: (id: string, title: string) => void;
  recolorNote: (id: string, color: string) => void;
  moveNote: (id: string, delta: -1 | 1) => Promise<void>;
  moveNoteToTab: (id: string, tabId: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  /** Debounced through the autosave queue. */
  updateNoteContent: (id: string, content: JSONContent, plainText: string) => void;

  /** Re-reads tabs/notes after a bulk change such as import or reset. */
  refreshAfterBulkChange: () => Promise<void>;
}

/** What "Pin to URL" is currently doing, for the indicator and the pin editor. */
export interface PinStatus {
  /** The active tab's URL, or `null` when unknown or not permitted. */
  activeUrl: string | null;
  /** Whether the optional `tabs` permission is held. */
  granted: boolean;
  /** Whether the "show hidden" override is on. */
  showHidden: boolean;
  /** True where pins do not apply, such as the full-page view. */
  inert: boolean;
  /** Tabs a pin is hiding right now. */
  hiddenTabCount: number;
  /** Notes in the selected tab a pin is hiding right now. */
  hiddenNoteCount: number;
}

export interface WorkspaceApi {
  loading: boolean;
  /** Tabs after pins have been applied. */
  tabs: readonly NoteTab[];
  /** Notes in the selected tab, after pins have been applied. */
  notes: readonly NoteMeta[];
  /** Every tab, ignoring pins. Used where hiding would be wrong, such as
   * "Move note to tab…" — a pin must never make a tab unreachable. */
  allTabs: readonly NoteTab[];
  noteCounts: Readonly<Record<string, number>>;
  totalNoteCount: number;

  pinStatus: PinStatus;
  setShowHiddenPins: (value: boolean) => void;

  selectedTabId: string | null;
  selectedNoteId: string | null;
  selectedTab: NoteTab | null;
  selectedNote: NoteMeta | null;

  selectTab: (id: string) => void;
  selectNote: (id: string | null) => void;
  /** Used by global search results, which may live in another tab. */
  revealNote: (tabId: string, noteId: string) => void;

  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => void;

  actions: WorkspaceActions;
  /** Writes every pending autosave immediately. */
  flushSaves: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside <WorkspaceProvider>.');
  return context;
}
