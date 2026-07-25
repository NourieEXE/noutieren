import { useCallback, useEffect, useState } from 'react';
import type { JSONContent } from '../types';
import { getNote, getNoteContent } from '../database/notesRepository';
import { createEmptyDocument } from '../editor/document';
import { saveQueue } from '../services/saveQueue';
import { logError } from '../services/errors';

export interface NoteContentState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  noteId: string | null;
  content: JSONContent | null;
}

interface LoadedContent {
  noteId: string;
  content: JSONContent;
}

/**
 * Loads one note's rich-text document.
 *
 * Two safeguards live here:
 *
 * - A cancellation flag means a slow load for a note the user already left can
 *   never replace the content of the note they are now on.
 * - The note's `updatedAt` is registered with the autosave queue as this
 *   session's base version, which is what makes conflict detection possible.
 *
 * The status is derived during render from which note is loaded, rather than
 * written by the effect, so a note switch never causes a cascading re-render.
 */
export function useNoteContent(noteId: string | null): NoteContentState & {
  reload: () => void;
  reloadToken: number;
} {
  const [loaded, setLoaded] = useState<LoadedContent | null>(null);
  const [failedNoteId, setFailedNoteId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!noteId) return undefined;

    let cancelled = false;

    void (async () => {
      try {
        const [content, meta] = await Promise.all([getNoteContent(noteId), getNote(noteId)]);
        if (cancelled) return;
        saveQueue.setBaseVersion(noteId, meta?.updatedAt ?? null);
        setLoaded({ noteId, content: content ?? createEmptyDocument() });
      } catch (error) {
        logError('useNoteContent', error);
        if (!cancelled) setFailedNoteId(noteId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [noteId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  let status: NoteContentState['status'] = 'loading';
  if (!noteId) status = 'idle';
  else if (failedNoteId === noteId) status = 'error';
  else if (loaded?.noteId === noteId) status = 'ready';

  return {
    status,
    noteId,
    content: status === 'ready' ? (loaded?.content ?? null) : null,
    reload,
    reloadToken,
  };
}
