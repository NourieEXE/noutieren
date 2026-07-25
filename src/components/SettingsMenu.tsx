import { useRef, useState } from 'react';
import { useWorkspace } from '../hooks/workspaceContext';
import { useToasts } from '../hooks/toastContext';
import {
  backupFilename,
  createBackup,
  importWithSafetyBackup,
  parseBackup,
  resetAllData,
  serializeBackup,
  type ParsedBackup,
} from '../services/backupService';
import { describeError, logError } from '../services/errors';
import { openFullPageEditor } from '../services/webext';
import { MAX_IMPORT_BYTES, downloadTextFile, readTextFile } from '../utils/download';
import type { ImportMode, ThemePreference } from '../types';
import { ConfirmDialog, Dialog } from './Dialog';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { Icon } from './Icons';

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Overflow menu: full-page editor, theme, backup, import and reset.
 *
 * Import always goes through a dialog that reports what was found in the file
 * and asks whether to replace or merge; a replace also downloads a safety copy
 * of the current data first.
 */
export function SettingsMenu() {
  const { preferences, updatePreferences, actions, flushSaves } = useWorkspace();
  const toasts = useToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingImport, setPendingImport] = useState<ParsedBackup | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    try {
      await flushSaves();
      const backup = await createBackup(preferences);
      downloadTextFile(backupFilename(), serializeBackup(backup));
      toasts.push({
        tone: 'success',
        message: `Exported ${backup.tabs.length} tabs and ${backup.notes.length} notes.`,
      });
    } catch (error) {
      logError('export', error);
      toasts.push({ tone: 'error', message: `Export failed. ${describeError(error)}` });
    }
  };

  const handleFileChosen = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        toasts.push({ tone: 'error', message: 'That file is too large to be a Noutieren backup.' });
        return;
      }
      const text = await readTextFile(file);
      setPendingImport(parseBackup(text));
    } catch (error) {
      logError('parseBackup', error);
      toasts.push({ tone: 'error', message: describeError(error) });
    }
  };

  const runImport = async (mode: ImportMode) => {
    const backup = pendingImport;
    if (!backup) return;
    setBusy(true);
    try {
      await flushSaves();
      const summary = await importWithSafetyBackup(
        backup,
        mode,
        (safety) => {
          downloadTextFile(backupFilename(new Date(), '-before-import'), serializeBackup(safety));
        },
        preferences,
      );
      await actions.refreshAfterBulkChange();
      setPendingImport(null);
      toasts.push({
        tone: 'success',
        duration: 8000,
        message:
          `Imported ${summary.notesImported} notes into ${summary.tabsImported} tabs` +
          `${mode === 'replace' ? ' (previous data replaced; a safety copy was downloaded)' : ''}.` +
          `${summary.repairs.length > 0 ? ` ${summary.repairs.length} item(s) were repaired.` : ''}`,
      });
    } catch (error) {
      logError('importBackup', error);
      toasts.push({ tone: 'error', message: `Import failed. ${describeError(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    try {
      await resetAllData();
      await actions.refreshAfterBulkChange();
      toasts.push({
        tone: 'success',
        message: 'All data was deleted and a new General tab created.',
      });
    } catch (error) {
      logError('resetAllData', error);
      toasts.push({ tone: 'error', message: `Reset failed. ${describeError(error)}` });
    }
  };

  return (
    <>
      <Menu label="Settings and data" trigger={<Icon name="gear" />}>
        {(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close();
                void openFullPageEditor();
              }}
            >
              <Icon name="externalLink" />
              Open full-page editor
            </MenuItem>

            <MenuSeparator label="Theme" />
            {THEME_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                onSelect={() => {
                  updatePreferences({ theme: option.value });
                  close();
                }}
              >
                <span className="menu__check" aria-hidden="true">
                  {preferences.theme === option.value ? <Icon name="check" /> : null}
                </span>
                {option.label}
                {preferences.theme === option.value ? (
                  <span className="visually-hidden"> (selected)</span>
                ) : null}
              </MenuItem>
            ))}

            <MenuSeparator label="Backup" />
            <MenuItem
              onSelect={() => {
                close();
                void handleExport();
              }}
            >
              <Icon name="copy" />
              Export all data…
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                fileInputRef.current?.click();
              }}
            >
              <Icon name="note" />
              Import data…
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              tone="danger"
              onSelect={() => {
                close();
                setResetOpen(true);
              }}
            >
              <Icon name="trash" />
              Reset all data…
            </MenuItem>
          </>
        )}
      </Menu>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so choosing the same file twice still fires a change event.
          event.target.value = '';
          if (file) void handleFileChosen(file);
        }}
      />

      <Dialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        title="Import backup"
        description={
          pendingImport
            ? `This file contains ${pendingImport.tabs.length} tabs and ${pendingImport.notes.length} notes, exported ${new Date(pendingImport.exportedAt).toLocaleString()}.`
            : ''
        }
        footer={
          <>
            <button type="button" className="button" onClick={() => setPendingImport(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void runImport('merge')}
            >
              Merge with my notes
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={busy}
              onClick={() => void runImport('replace')}
            >
              Replace everything
            </button>
          </>
        }
      >
        <ul className="bullet-list">
          <li>
            <strong>Merge</strong> keeps your current notes and adds the imported ones, giving new
            ids to anything that would collide.
          </li>
          <li>
            <strong>Replace</strong> deletes your current notes first. A safety copy of your current
            data is downloaded automatically before anything is removed.
          </li>
        </ul>
        {pendingImport && pendingImport.repairs.length > 0 ? (
          <details className="details">
            <summary>{pendingImport.repairs.length} item(s) needed repair</summary>
            <ul className="bullet-list">
              {pendingImport.repairs.slice(0, 20).map((repair, index) => (
                <li key={index}>{repair}</li>
              ))}
              {pendingImport.repairs.length > 20 ? <li>…</li> : null}
            </ul>
          </details>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={resetOpen}
        title="Delete all notes and tabs?"
        description="Every tab and note in this browser profile is permanently deleted, and a new empty General tab is created. This cannot be undone. Export a backup first if you might want this data."
        confirmLabel="Delete everything"
        onConfirm={() => void handleReset()}
        onClose={() => setResetOpen(false)}
      />
    </>
  );
}
