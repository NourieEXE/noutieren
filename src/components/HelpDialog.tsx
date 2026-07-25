import { Dialog } from './Dialog';

const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Ctrl/Cmd + N', action: 'New note in the current tab' },
  { keys: 'Ctrl/Cmd + Shift + N', action: 'New tab' },
  { keys: 'Ctrl/Cmd + K', action: 'Focus the search box' },
  { keys: 'Ctrl/Cmd + S', action: 'Save pending changes now' },
  { keys: 'Escape', action: 'Close the open dialog or menu' },
  { keys: 'Ctrl/Cmd + B / I / U', action: 'Bold / italic / underline' },
  { keys: 'Ctrl/Cmd + Shift + S', action: 'Strikethrough' },
  { keys: 'Ctrl/Cmd + E', action: 'Inline code' },
  { keys: 'Ctrl/Cmd + Z', action: 'Undo' },
  { keys: 'Ctrl/Cmd + Shift + Z', action: 'Redo' },
  { keys: '← / → , Home / End', action: 'Move between tabs (then Enter to open)' },
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Editing shortcuts work while the note content has focus."
      footer={
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <table className="shortcut-table">
        <caption className="visually-hidden">Keyboard shortcuts</caption>
        <thead>
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((shortcut) => (
            <tr key={shortcut.keys}>
              <td>
                <kbd>{shortcut.keys}</kbd>
              </td>
              <td>{shortcut.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dialog__note">
        Firefox reserves a few shortcuts for itself. If Ctrl+N opens a browser window instead of a
        note, use the <strong>New note</strong> button.
      </p>
    </Dialog>
  );
}
