import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useWorkspace } from '../hooks/workspaceContext';
import { useToasts } from '../hooks/toastContext';
import {
  TRASH_RETENTION_DAYS,
  deleteForever,
  emptyTrash,
  listTrash,
} from '../database/trashRepository';
import { describeError, logError } from '../services/errors';
import { formatAbsoluteTime, formatRelativeTime } from '../utils/time';
import { withAlpha } from '../utils/colors';
import { ConfirmDialog, Dialog } from './Dialog';
import { Icon } from './Icons';

export function RecentlyDeletedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions } = useWorkspace();
  const toasts = useToasts();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const entries = useLiveQuery(() => (open ? listTrash() : []), [open]);
  const count = entries?.length ?? 0;

  const run = (context: string, task: () => Promise<void>) => {
    task().catch((error: unknown) => {
      logError(context, error);
      toasts.push({ tone: 'error', message: describeError(error) });
    });
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Recently deleted"
        description={`Deleted notes stay here for ${TRASH_RETENTION_DAYS} days, then they are gone for good.`}
        footer={
          <>
            <button
              type="button"
              className="button button--danger"
              disabled={count === 0}
              onClick={() => setConfirmEmpty(true)}
            >
              Empty
            </button>
            <button type="button" className="button button--primary" onClick={onClose}>
              Done
            </button>
          </>
        }
      >
        {entries && count === 0 ? <p className="pin-list__empty">Nothing here.</p> : null}
        {count > 0 ? (
          <ul className="trash-list" aria-label="Deleted notes">
            {entries!.map((entry) => (
              <li
                key={entry.noteId}
                className="trash-list__item"
                style={{ ['--note-color' as string]: entry.meta.color }}
              >
                <span className="note-row__strip" aria-hidden="true" />
                <span className="trash-list__text">
                  <span className="trash-list__title">{entry.meta.title}</span>
                  <span className="trash-list__meta">
                    {entry.tab ? (
                      <span
                        className="chip"
                        style={{ background: withAlpha(entry.tab.color, 0.18) }}
                      >
                        <span
                          className="chip__dot"
                          style={{ background: entry.tab.color }}
                          aria-hidden="true"
                        />
                        {entry.tab.title}
                      </span>
                    ) : null}
                    <time
                      dateTime={new Date(entry.deletedAt).toISOString()}
                      title={formatAbsoluteTime(entry.deletedAt)}
                    >
                      Deleted {formatRelativeTime(entry.deletedAt)}
                    </time>
                  </span>
                </span>
                <button
                  type="button"
                  className="button button--compact"
                  onClick={() => void actions.restoreDeletedNote(entry.noteId)}
                  aria-label={`Restore "${entry.meta.title}"`}
                >
                  <Icon name="undo" />
                  Restore
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => run('deleteForever', () => deleteForever(entry.noteId))}
                  aria-label={`Delete "${entry.meta.title}" forever`}
                  title="Delete forever"
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmEmpty}
        title="Empty Recently deleted?"
        description={`${count === 1 ? 'The note' : `All ${count} notes`} here will be deleted for good. This cannot be undone.`}
        confirmLabel="Delete forever"
        onConfirm={() => run('emptyTrash', emptyTrash)}
        onClose={() => setConfirmEmpty(false)}
      />
    </>
  );
}
