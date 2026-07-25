import { createContext, useContext } from 'react';
import type { AppPreferences, JSONContent, NoteMeta, NoteTab } from '../types';

export interface WorkspaceActions {
  createTab: () => Promise<void>;
  renameTab: (id: string, title: string) => Promise<void>;
  recolorTab: (id: string, color: string) => Promise<void>;
  moveTab: (id: string, delta: -1 | 1) => Promise<void>;
  deleteTab: (id: string) => Promise<void>;

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

export interface WorkspaceApi {
  loading: boolean;
  tabs: readonly NoteTab[];
  notes: readonly NoteMeta[];
  noteCounts: Readonly<Record<string, number>>;
  totalNoteCount: number;

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
