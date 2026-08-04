import { useEffect, useId, useRef, useState } from 'react';
import type { NoteTab } from '../types';
import { ConfirmDialog, Dialog } from './Dialog';
import { ColorPicker } from './ColorPicker';
import { PinToUrlField } from './PinToUrlField';
import { Icon } from './Icons';

/**
 * Rename, recolor, reorder or delete a tab.
 *
 * Deletion lives behind this dialog *and* a confirmation that states how many
 * notes go with it, so a tab can never be destroyed by one stray click.
 */
export function TabSettingsDialog({
  tab,
  noteCount,
  canMoveLeft,
  canMoveRight,
  open,
  onClose,
  onRename,
  onRecolor,
  onMove,
  onDelete,
  onPin,
  onRequestPermission,
  activeUrl,
  pinPermissionGranted,
}: {
  tab: NoteTab;
  noteCount: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  open: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  onRecolor: (color: string) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onPin: (patterns: string[]) => Promise<void>;
  onRequestPermission: () => Promise<'granted' | 'denied' | 'elsewhere'>;
  activeUrl: string | null;
  pinPermissionGranted: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The name field lives in a child that only exists while the dialog is open,
  // so it initialises from the tab on mount instead of being synced by an
  // effect every time the dialog opens.
  const commitRef = useRef<() => void>(() => undefined);

  const closeWithCommit = () => {
    commitRef.current();
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={closeWithCommit}
        title="Tab settings"
        footer={
          <>
            <button
              type="button"
              className="button button--danger"
              onClick={() => setConfirmOpen(true)}
            >
              <Icon name="trash" />
              Delete tab
            </button>
            <button type="button" className="button button--primary" onClick={closeWithCommit}>
              Done
            </button>
          </>
        }
      >
        <TabNameField
          key={tab.id}
          initialTitle={tab.title}
          onRename={onRename}
          registerCommit={(commit) => {
            commitRef.current = commit;
          }}
        />

        <ColorPicker value={tab.color} onChange={onRecolor} label="Tab color" />

        <PinToUrlField
          patterns={tab.urlPatterns ?? []}
          activeUrl={activeUrl}
          granted={pinPermissionGranted}
          onRequestPermission={onRequestPermission}
          label="Pin to URL"
          description="Show this tab only while one of these pages is open. Leave empty to always show it."
          onChange={(patterns) => void onPin(patterns)}
        />

        <div className="field">
          <span className="field__label">Position</span>
          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled={!canMoveLeft}
              onClick={() => onMove(-1)}
            >
              <Icon name="chevronLeft" />
              Move left
            </button>
            <button
              type="button"
              className="button"
              disabled={!canMoveRight}
              onClick={() => onMove(1)}
            >
              Move right
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>

        <p className="dialog__note">
          This tab contains {noteCount} {noteCount === 1 ? 'note' : 'notes'}.
        </p>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete "${tab.title}"?`}
        description={
          noteCount === 0
            ? 'This tab is empty. Deleting it cannot be undone.'
            : `This permanently deletes the tab and its ${noteCount} ${
                noteCount === 1 ? 'note' : 'notes'
              }. This cannot be undone.`
        }
        confirmLabel={noteCount === 0 ? 'Delete tab' : `Delete tab and ${noteCount} notes`}
        onConfirm={() => {
          onDelete();
          onClose();
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}

/**
 * The tab name field.
 *
 * Mounted only while the dialog is open, so its value starts from the tab and
 * no effect is needed to keep them in step. The commit function is handed
 * upwards so closing the dialog also saves a pending rename.
 */
function TabNameField({
  initialTitle,
  onRename,
  registerCommit,
}: {
  initialTitle: string;
  onRename: (title: string) => void;
  registerCommit: (commit: () => void) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const titleId = useId();

  const commit = () => {
    const next = title.trim();
    if (next.length === 0) {
      setTitle(initialTitle);
      return;
    }
    if (next !== initialTitle) onRename(next);
  };

  // Registered after commit rather than during render, so closing the dialog
  // always saves the value currently in the field.
  useEffect(() => {
    registerCommit(commit);
  });

  return (
    <div className="field">
      <label className="field__label" htmlFor={titleId}>
        Tab name
      </label>
      <input
        id={titleId}
        className="input"
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}
