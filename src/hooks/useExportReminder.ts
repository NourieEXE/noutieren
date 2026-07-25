import { useEffect, useRef } from 'react';
import { useWorkspace } from './workspaceContext';
import { useToasts } from './toastContext';
import { EXPORT_REMINDER_DAYS, shouldRemindToExport } from '../services/storageDurability';
import { getDatabase } from '../database/db';
import { logError } from '../services/errors';

/**
 * Reminds the user to take a backup when their last one has gone stale.
 *
 * Notes live only in this browser profile: deleting it, or moving machines,
 * takes the notes with it. Someone who installed from the add-on store has not
 * read the README, so the application has to say this itself.
 *
 * It fires at most once per session, never on a workspace that holds only the
 * seeded note, and offers the export directly rather than just complaining.
 */
export function useExportReminder(onExport: () => void): void {
  const { preferences, totalNoteCount, loading } = useWorkspace();
  const toasts = useToasts();
  const shown = useRef(false);
  const onExportRef = useRef(onExport);

  useEffect(() => {
    onExportRef.current = onExport;
  });

  useEffect(() => {
    if (loading || shown.current || totalNoteCount < 2) return;

    let cancelled = false;
    void (async () => {
      // Measured from when the workspace was first created, so a new install
      // stays quiet until it holds a few weeks of work. The first tab's
      // timestamp stands in for that: `notes.createdAt` is not indexed, and
      // adding an index purely for a reminder would mean a schema migration.
      let workspaceCreatedAt: number | null;
      try {
        const firstTab = await getDatabase().tabs.orderBy('position').first();
        workspaceCreatedAt = firstTab?.createdAt ?? null;
      } catch (error) {
        // A reminder is never worth breaking the app over.
        logError('useExportReminder', error);
        return;
      }
      if (cancelled || shown.current) return;

      const due = shouldRemindToExport({
        lastExportedAt: preferences.lastExportedAt,
        noteCount: totalNoteCount,
        oldestNoteCreatedAt: workspaceCreatedAt,
      });
      if (!due) return;

      shown.current = true;
      toasts.push({
        duration: 0,
        message:
          preferences.lastExportedAt === null
            ? 'Your notes are stored only in this Firefox profile and have never been backed up.'
            : `It has been over ${EXPORT_REMINDER_DAYS} days since your last backup.`,
        action: {
          label: 'Export now',
          onAction: () => onExportRef.current(),
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, preferences.lastExportedAt, totalNoteCount, toasts]);
}
