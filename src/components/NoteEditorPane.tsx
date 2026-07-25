import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../hooks/workspaceContext';
import { useNoteContent } from '../hooks/useNoteContent';
import { RichTextEditor } from '../editor/RichTextEditor';
import { saveQueue } from '../services/saveQueue';
import { formatAbsoluteTime, formatRelativeTime } from '../utils/time';
import { colorName } from '../utils/colors';
import type { NoteMeta } from '../types';
import { Dialog } from './Dialog';
import { ColorPicker } from './ColorPicker';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { Icon } from './Icons';
import { SaveStatus } from './SaveStatus';

/**
 * Editor for the selected note: title, color, actions, and the rich-text
 * document.
 *
 * All note-level actions live in one menu that acts on the selected note, which
 * keeps the notes list itself cheap to render for very long lists.
 */
export function NoteEditorPane() {
  const { selectedNote, notes, tabs, selectedTabId, actions } = useWorkspace();
  const paneRef = useRef<HTMLElement>(null);
  const [colorDialogOpen, setColorDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);

  const noteId = selectedNote?.id ?? null;
  const { status, content, reload } = useNoteContent(noteId);

  /**
   * Pick up edits made to this note in another window.
   *
   * Only when nothing is queued for it locally (so no typed text can be lost)
   * and focus is elsewhere in the app (so the cursor is never yanked away).
   */
  useEffect(() => {
    if (!selectedNote) return;
    const base = saveQueue.getBaseVersion(selectedNote.id);
    if (base === null || selectedNote.updatedAt <= base) return;
    if (saveQueue.hasPending(selectedNote.id)) return;
    if (paneRef.current?.contains(document.activeElement)) return;
    reload();
  }, [selectedNote, reload]);

  if (!selectedNote) {
    return (
      <section className="editor-pane editor-pane--empty" aria-label="Note editor" ref={paneRef}>
        <div className="empty-state">
          <p className="empty-state__title">No note selected.</p>
          <p className="empty-state__hint">
            Create a note to start writing — it saves automatically as you type.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void actions.createNote()}
            disabled={!selectedTabId}
          >
            <Icon name="plus" />
            New note
          </button>
        </div>
      </section>
    );
  }

  const index = notes.findIndex((note) => note.id === selectedNote.id);
  const otherTabs = tabs.filter((tab) => tab.id !== selectedNote.tabId);

  return (
    <section className="editor-pane" aria-label="Note editor" ref={paneRef}>
      <header className="editor-pane__header">
        <span
          className="note-color-dot"
          style={{ background: selectedNote.color }}
          aria-hidden="true"
        />
        <NoteTitleField key={selectedNote.id} note={selectedNote} onRename={actions.renameNote} />

        <SaveStatus />

        <button
          type="button"
          className="icon-button"
          onClick={() => setColorDialogOpen(true)}
          aria-label={`Note color: ${colorName(selectedNote.color)}`}
          title="Note color"
        >
          <Icon name="palette" />
        </button>

        <Menu label="Note actions" trigger={<Icon name="dots" />}>
          {(close) => (
            <>
              <MenuItem
                onSelect={() => {
                  close();
                  void actions.duplicateNote(selectedNote.id);
                }}
              >
                <Icon name="copy" />
                Duplicate note
              </MenuItem>
              <MenuItem
                disabled={index <= 0}
                onSelect={() => {
                  close();
                  void actions.moveNote(selectedNote.id, -1);
                }}
              >
                <Icon name="arrowUp" />
                Move up
              </MenuItem>
              <MenuItem
                disabled={index === -1 || index >= notes.length - 1}
                onSelect={() => {
                  close();
                  void actions.moveNote(selectedNote.id, 1);
                }}
              >
                <Icon name="arrowDown" />
                Move down
              </MenuItem>
              <MenuItem
                disabled={otherTabs.length === 0}
                onSelect={() => {
                  close();
                  setMoveDialogOpen(true);
                }}
              >
                <Icon name="moveTo" />
                Move to tab…
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                tone="danger"
                onSelect={() => {
                  close();
                  void actions.deleteNote(selectedNote.id);
                }}
              >
                <Icon name="trash" />
                Delete note
              </MenuItem>
            </>
          )}
        </Menu>
      </header>

      {status === 'error' ? (
        <div className="notice notice--error" role="alert">
          <Icon name="warning" />
          <span>
            This note’s content could not be read from local storage. Try reloading the sidebar; the
            note itself has not been changed.
          </span>
        </div>
      ) : null}

      {status === 'ready' && content ? (
        // key: a fresh editor per note. See RichTextEditor's documentation.
        <RichTextEditor
          key={selectedNote.id}
          noteId={selectedNote.id}
          initialContent={content}
          ariaLabel={`Note content: ${selectedNote.title}`}
          onChange={actions.updateNoteContent}
          onFlush={(id) => void saveQueue.flush(id)}
        />
      ) : null}

      {status === 'loading' ? <p className="editor-pane__loading">Loading note…</p> : null}

      <footer className="editor-pane__footer">
        <span title={formatAbsoluteTime(selectedNote.updatedAt)}>
          Updated {formatRelativeTime(selectedNote.updatedAt)}
        </span>
        <span title={formatAbsoluteTime(selectedNote.createdAt)}>
          Created {formatRelativeTime(selectedNote.createdAt)}
        </span>
      </footer>

      <Dialog
        open={colorDialogOpen}
        onClose={() => setColorDialogOpen(false)}
        title="Note color"
        footer={
          <button
            type="button"
            className="button button--primary"
            onClick={() => setColorDialogOpen(false)}
          >
            Done
          </button>
        }
      >
        <ColorPicker
          value={selectedNote.color}
          label="Choose a color for this note"
          onChange={(color) => actions.recolorNote(selectedNote.id, color)}
        />
      </Dialog>

      <Dialog
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        title="Move note to tab"
        description={`Move "${selectedNote.title}" to another tab.`}
      >
        <ul className="option-list">
          {otherTabs.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                className="option-list__button"
                onClick={() => {
                  setMoveDialogOpen(false);
                  void actions.moveNoteToTab(selectedNote.id, tab.id);
                }}
              >
                <span className="chip__dot" style={{ background: tab.color }} aria-hidden="true" />
                {tab.title}
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </section>
  );
}

/**
 * Note title.
 *
 * Mounted with `key={note.id}`, so switching notes resets the field. Edits go
 * through the same debounced autosave queue as the document.
 */
function NoteTitleField({
  note,
  onRename,
}: {
  note: NoteMeta;
  onRename: (id: string, title: string) => void;
}) {
  const [value, setValue] = useState(note.title);

  return (
    <input
      className="editor-pane__title"
      value={value}
      maxLength={200}
      aria-label="Note title"
      placeholder="Untitled note"
      onChange={(event) => {
        setValue(event.target.value);
        const trimmed = event.target.value.trim();
        if (trimmed.length > 0) onRename(note.id, trimmed);
      }}
      onBlur={() => {
        if (value.trim().length === 0) setValue(note.title);
        void saveQueue.flush(note.id);
      }}
    />
  );
}
