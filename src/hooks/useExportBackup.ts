import { useCallback } from 'react';
import { useWorkspace } from './workspaceContext';
import { useToasts } from './toastContext';
import { backupFilename, createBackup, serializeBackup } from '../services/backupService';
import { downloadTextFile } from '../utils/download';
import { describeError, logError } from '../services/errors';

/**
 * Exports every tab and note to a JSON file.
 *
 * Shared by the settings menu and the staleness reminder so both record the
 * backup timestamp — a reminder that did not count as a backup would nag
 * forever.
 */
export function useExportBackup(): () => Promise<void> {
  const { preferences, updatePreferences, flushSaves } = useWorkspace();
  const toasts = useToasts();

  return useCallback(async () => {
    try {
      // Write anything still queued, so the backup includes the last keystroke.
      await flushSaves();
      const backup = await createBackup(preferences);
      downloadTextFile(backupFilename(), serializeBackup(backup));
      updatePreferences({ lastExportedAt: Date.now() });
      toasts.push({
        tone: 'success',
        message: `Exported ${backup.tabs.length} tabs and ${backup.notes.length} notes.`,
      });
    } catch (error) {
      logError('export', error);
      toasts.push({ tone: 'error', message: `Export failed. ${describeError(error)}` });
    }
  }, [flushSaves, preferences, toasts, updatePreferences]);
}
