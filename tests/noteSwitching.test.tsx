import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The scenario the specification calls out, driven through the real UI:
 * type in note A, switch to B, type, come back to A. Both notes must keep
 * their own text.
 *
 * The rich-text editor is replaced with a textarea that calls the same
 * `onChange`/`onFlush` contract. That keeps the test about the wiring under
 * test — selection, the autosave queue and the database — rather than about
 * ProseMirror's behaviour inside jsdom.
 */
vi.mock('../src/editor/RichTextEditor', () => ({
  RichTextEditor: ({
    noteId,
    initialContent,
    onChange,
    onFlush,
  }: {
    noteId: string;
    initialContent: { type: string; content?: unknown[] };
    onChange: (id: string, content: unknown, plainText: string) => void;
    onFlush: (id: string) => void;
  }) => {
    const asText = JSON.stringify(initialContent).match(/"text":"([^"]*)"/)?.[1] ?? '';
    return (
      <textarea
        aria-label="Note content"
        data-note-id={noteId}
        defaultValue={asText}
        onChange={(event) =>
          onChange(
            noteId,
            {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: event.target.value }] },
              ],
            },
            event.target.value,
          )
        }
        onBlur={() => onFlush(noteId)}
      />
    );
  },
}));

const { resetDatabase } = await import('./helpers');
const { App } = await import('../src/app/App');
const { WorkspaceProvider } = await import('../src/app/WorkspaceProvider');
const { ToastProvider } = await import('../src/components/ToastProvider');
const { DEFAULT_PREFERENCES } = await import('../src/services/preferences');
const { ensureSeeded } = await import('../src/services/workspaceService');
const { openDatabase } = await import('../src/database/db');
const { createTab } = await import('../src/database/tabsRepository');
const { createNote, getNote, getNoteContent } = await import('../src/database/notesRepository');
const { saveQueue } = await import('../src/services/saveQueue');

async function renderApp(selectedTabId: string) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <WorkspaceProvider initialPreferences={{ ...DEFAULT_PREFERENCES, selectedTabId }}>
        <App />
      </WorkspaceProvider>
    </ToastProvider>,
  );
  await waitFor(() => expect(screen.queryByText(/Loading your notes/)).toBeNull());
  await waitFor(() => expect(screen.getByLabelText('Note content')).toBeInTheDocument());
  return { user };
}

function noteRow(title: string) {
  return within(screen.getByRole('list', { name: 'Notes' })).getByText(title);
}

function editor() {
  return screen.getByLabelText('Note content');
}

/** Text of the document stored for a note. */
async function storedText(noteId: string): Promise<string> {
  const content = (await getNoteContent(noteId)) as
    { content?: { content?: { text?: string }[] }[] } | undefined;
  return content?.content?.[0]?.content?.[0]?.text ?? '';
}

beforeEach(async () => {
  await resetDatabase();
  await openDatabase();
  await ensureSeeded();
});

describe('switching notes while typing', () => {
  it('keeps each note’s content when moving A → B → A', async () => {
    const tab = await createTab({ title: 'Work' });
    const a = await createNote({ tabId: tab.id, title: 'Note A' });
    const b = await createNote({ tabId: tab.id, title: 'Note B' });
    const { user } = await renderApp(tab.id);

    // 1. Type in note A.
    await user.click(noteRow('Note A'));
    await waitFor(() => expect(editor()).toHaveAttribute('data-note-id', a.id));
    await user.type(editor(), 'alpha content');

    // 2. Immediately switch to note B and type there.
    await user.click(noteRow('Note B'));
    await waitFor(() => expect(editor()).toHaveAttribute('data-note-id', b.id));
    // B starts empty — A's text must not have leaked into this editor.
    expect(editor()).toHaveValue('');
    await user.type(editor(), 'beta content');

    // 3. Return to note A.
    await user.click(noteRow('Note A'));
    await waitFor(() => expect(editor()).toHaveAttribute('data-note-id', a.id));

    // The editor shows A's text, not B's.
    await waitFor(() => expect(editor()).toHaveValue('alpha content'));

    // And both notes are stored correctly.
    await saveQueue.flush();
    expect(await storedText(a.id)).toBe('alpha content');
    expect(await storedText(b.id)).toBe('beta content');
    expect((await getNote(a.id))!.plainText).toBe('alpha content');
    expect((await getNote(b.id))!.plainText).toBe('beta content');
  });

  it('survives switching faster than the autosave debounce', async () => {
    const tab = await createTab({ title: 'Work' });
    const notes = [];
    for (const title of ['One', 'Two', 'Three']) {
      notes.push(await createNote({ tabId: tab.id, title }));
    }
    const { user } = await renderApp(tab.id);

    // Type one character in each note, hopping between them with no pauses.
    for (const [index, note] of notes.entries()) {
      await user.click(noteRow(note.title));
      await waitFor(() => expect(editor()).toHaveAttribute('data-note-id', note.id));
      await user.type(editor(), `text-${index}`);
    }

    await saveQueue.flush();

    for (const [index, note] of notes.entries()) {
      expect(await storedText(note.id), note.title).toBe(`text-${index}`);
    }
  });

  it('writes the note being left rather than waiting for its debounce', async () => {
    const tab = await createTab({ title: 'Work' });
    const a = await createNote({ tabId: tab.id, title: 'Note A' });
    await createNote({ tabId: tab.id, title: 'Note B' });
    const { user } = await renderApp(tab.id);

    await user.click(noteRow('Note A'));
    await waitFor(() => expect(editor()).toHaveAttribute('data-note-id', a.id));
    await user.type(editor(), 'saved on switch');

    await user.click(noteRow('Note B'));

    // No explicit flush here: selecting another note must have written A.
    await waitFor(async () => {
      expect(await storedText(a.id)).toBe('saved on switch');
    });
  });

  it('does not write one note’s title onto another', async () => {
    const tab = await createTab({ title: 'Work' });
    const a = await createNote({ tabId: tab.id, title: 'Note A' });
    const b = await createNote({ tabId: tab.id, title: 'Note B' });
    const { user } = await renderApp(tab.id);

    await user.click(noteRow('Note A'));
    const title = screen.getByRole('textbox', { name: 'Note title' });
    await user.clear(title);
    await user.type(title, 'Renamed A');

    await user.click(noteRow('Note B'));
    await saveQueue.flush();

    expect((await getNote(a.id))!.title).toBe('Renamed A');
    expect((await getNote(b.id))!.title).toBe('Note B');
  });

  it('shows a saved status once the write lands', async () => {
    const tab = await createTab({ title: 'Work' });
    await createNote({ tabId: tab.id, title: 'Note A' });
    const { user } = await renderApp(tab.id);

    await user.click(noteRow('Note A'));
    await user.type(editor(), 'x');

    // Saving… then Saved, announced through the editor's own live region
    // (the toast layer has a separate one).
    const pane = screen.getByRole('region', { name: 'Note editor' });
    await waitFor(() => expect(within(pane).getByRole('status')).toHaveTextContent(/Saving|Saved/));
    await waitFor(() => expect(within(pane).getByRole('status')).toHaveTextContent('Saved'), {
      timeout: 3000,
    });
  });
});
