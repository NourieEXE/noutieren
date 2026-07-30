import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Note and tab actions as the user performs them.
 *
 * The editor is stubbed (see noteSwitching.test.tsx for why) because these
 * tests are about the surrounding controls, not about text editing.
 */
vi.mock('../src/editor/RichTextEditor', () => ({
  RichTextEditor: ({ noteId }: { noteId: string }) => (
    <div data-note-id={noteId} aria-label="Note content" />
  ),
}));

const { resetDatabase, doc } = await import('./helpers');
const { App } = await import('../src/app/App');
const { WorkspaceProvider } = await import('../src/app/WorkspaceProvider');
const { ToastProvider } = await import('../src/components/ToastProvider');
const { DEFAULT_PREFERENCES } = await import('../src/services/preferences');
const { ensureSeeded } = await import('../src/services/workspaceService');
const { openDatabase } = await import('../src/database/db');
const { createTab, listTabs } = await import('../src/database/tabsRepository');
const { countAllNotes, createNote, getNote, listNotesByTab } =
  await import('../src/database/notesRepository');

async function renderApp(selectedTabId?: string) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <WorkspaceProvider
        initialPreferences={{ ...DEFAULT_PREFERENCES, selectedTabId: selectedTabId ?? null }}
      >
        <App />
      </WorkspaceProvider>
    </ToastProvider>,
  );
  await waitFor(() => expect(screen.queryByText(/Loading your notes/)).toBeNull());
  return { user };
}

function list() {
  return screen.getByRole('list', { name: 'Notes' });
}

function rowTitles() {
  return within(list())
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.note-row__title')?.textContent ?? '');
}

/**
 * Opens the note actions menu and clicks one of its items. The menu only exists
 * once a note is selected, which happens a tick after the list loads.
 */
async function useNoteMenu(user: ReturnType<typeof userEvent.setup>, item: RegExp) {
  await user.click(await screen.findByRole('button', { name: 'Note actions' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

beforeEach(async () => {
  await resetDatabase();
  await openDatabase();
  await ensureSeeded();
});

describe('note actions', () => {
  it('duplicates a note and selects the copy', async () => {
    const tab = await createTab({ title: 'Work' });
    await createNote({ tabId: tab.id, title: 'Original', content: doc('body') });
    const { user } = await renderApp(tab.id);

    await useNoteMenu(user, /Duplicate note/);

    await waitFor(() => expect(rowTitles()).toEqual(['Original', 'Original (copy)']));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Original (copy)'),
    );
  });

  it('deletes a note and offers an undo that restores it', async () => {
    const tab = await createTab({ title: 'Work' });
    await createNote({ tabId: tab.id, title: 'Keep me', content: doc('precious') });
    await createNote({ tabId: tab.id, title: 'Other' });
    const { user } = await renderApp(tab.id);

    await waitFor(() => expect(rowTitles()).toEqual(['Keep me', 'Other']));
    await useNoteMenu(user, /Delete note/);

    // Gone, with an undo offered rather than a confirmation prompt.
    await waitFor(() => expect(rowTitles()).toEqual(['Other']));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(screen.getByText(/Deleted "Keep me"/)).toBeInTheDocument();

    await user.click(undo);

    await waitFor(() => expect(rowTitles()).toContain('Keep me'));
    const restored = (await listNotesByTab(tab.id)).find((note) => note.title === 'Keep me');
    expect(restored).toBeDefined();
    expect(restored!.plainText).toBe('precious');
  });

  it('moves a note up and down', async () => {
    const tab = await createTab({ title: 'Work' });
    await createNote({ tabId: tab.id, title: 'First' });
    await createNote({ tabId: tab.id, title: 'Second' });
    const { user } = await renderApp(tab.id);

    await waitFor(() => expect(rowTitles()).toEqual(['First', 'Second']));

    // The first note cannot move up.
    await user.click(await screen.findByRole('button', { name: 'Note actions' }));
    expect(await screen.findByRole('menuitem', { name: /Move up/ })).toBeDisabled();
    await user.click(await screen.findByRole('menuitem', { name: /Move down/ }));

    await waitFor(() => expect(rowTitles()).toEqual(['Second', 'First']));

    await useNoteMenu(user, /Move up/);
    await waitFor(() => expect(rowTitles()).toEqual(['First', 'Second']));
  });

  it('moves a note to another tab', async () => {
    const from = await createTab({ title: 'From' });
    const to = await createTab({ title: 'To' });
    const note = await createNote({ tabId: from.id, title: 'Traveller' });
    const { user } = await renderApp(from.id);

    await waitFor(() => expect(rowTitles()).toEqual(['Traveller']));
    await useNoteMenu(user, /Move to tab/);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^To$/ }));

    await waitFor(async () => {
      expect((await getNote(note.id))!.tabId).toBe(to.id);
    });
    // It left the current tab's list.
    await waitFor(() => expect(within(list()).queryByText('Traveller')).toBeNull());
  });

  it('changes a note colour from the picker', async () => {
    const tab = await createTab({ title: 'Work' });
    const note = await createNote({ tabId: tab.id, title: 'Colourful' });
    const { user } = await renderApp(tab.id);

    await user.click(await screen.findByRole('button', { name: /Note color/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Red' }));

    await waitFor(async () => {
      expect((await getNote(note.id))!.color).toBe('#ef4444');
    });
    // The selected swatch is marked, not merely coloured.
    expect(within(dialog).getByRole('radio', { name: 'Red' })).toBeChecked();
  });
});

describe('tab actions', () => {
  it('renames a tab from its settings dialog', async () => {
    const tab = await createTab({ title: 'Before' });
    const { user } = await renderApp(tab.id);

    await user.click(screen.getByRole('button', { name: /Settings for tab "Before"/ }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByRole('textbox', { name: 'Tab name' });
    await user.clear(field);
    await user.type(field, 'After');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.getByRole('tab', { name: /After/ })).toBeInTheDocument());
    expect((await listTabs()).map((item) => item.title)).toContain('After');
  });

  it('recolours a tab and keeps its label readable', async () => {
    const tab = await createTab({ title: 'Colour me' });
    const { user } = await renderApp(tab.id);

    await user.click(screen.getByRole('button', { name: /Settings for tab "Colour me"/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Amber' }));

    await waitFor(async () => {
      const updated = (await listTabs()).find((item) => item.id === tab.id);
      expect(updated!.color).toBe('#f59e0b');
    });

    // Selected tab: its own colour as background with a contrasting foreground.
    // Waited for separately from the row above: storing the colour and painting
    // it are two steps, with the live query and a re-render in between.
    await waitFor(() => {
      const tabButton = screen.getByRole('tab', { name: /Colour me/ });
      expect(tabButton.style.background).toBe('rgb(245, 158, 11)');
      expect(tabButton.style.color).toBe('rgb(15, 23, 42)');
    });
  });

  it('reorders tabs from the settings dialog', async () => {
    const first = await createTab({ title: 'Alpha' });
    await createTab({ title: 'Beta' });
    const { user } = await renderApp(first.id);

    // Order starts as General, Alpha, Beta (General is seeded first).
    await user.click(screen.getByRole('button', { name: /Settings for tab "Alpha"/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Move right/ }));

    await waitFor(async () => {
      expect((await listTabs()).map((tab) => tab.title)).toEqual(['General', 'Beta', 'Alpha']);
    });

    await user.click(within(dialog).getByRole('button', { name: /Move left/ }));
    await waitFor(async () => {
      expect((await listTabs()).map((tab) => tab.title)).toEqual(['General', 'Alpha', 'Beta']);
    });
  });

  it('disables the move buttons at either end of the strip', async () => {
    const tabs = await listTabs();
    const { user } = await renderApp(tabs[0].id);
    await createTab({ title: 'Second' });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));

    // General is leftmost, so it cannot move further left.
    await user.click(screen.getByRole('button', { name: /Settings for tab "General"/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /Move left/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /Move right/ })).not.toBeDisabled();
  });

  it('requires two deliberate steps and states the cost before deleting a tab with notes', async () => {
    const tab = await createTab({ title: 'Doomed' });
    await createNote({ tabId: tab.id, title: 'One' });
    await createNote({ tabId: tab.id, title: 'Two' });
    const { user } = await renderApp(tab.id);

    // Step one: open tab settings. Nothing is deleted by opening it.
    await user.click(screen.getByRole('button', { name: /Settings for tab "Doomed"/ }));
    const settings = await screen.findByRole('dialog');
    expect(within(settings).getByText(/contains 2 notes/)).toBeInTheDocument();
    await user.click(within(settings).getByRole('button', { name: /Delete tab/ }));

    // Step two: confirm, with the number of notes spelled out.
    const confirm = await screen.findByRole('dialog', { name: /Delete "Doomed"\?/ });
    expect(within(confirm).getByText(/its 2 notes/)).toBeInTheDocument();
    expect(await listTabs()).toHaveLength(2);

    await user.click(within(confirm).getByRole('button', { name: /Delete tab and 2 notes/ }));

    await waitFor(async () => {
      expect((await listTabs()).map((item) => item.title)).toEqual(['General']);
    });
    // The tab's notes went with it; General's seeded note remains.
    expect(await countAllNotes()).toBe(1);
  });

  it('can be cancelled without deleting anything', async () => {
    const tab = await createTab({ title: 'Safe' });
    await createNote({ tabId: tab.id, title: 'Note' });
    const { user } = await renderApp(tab.id);

    await user.click(screen.getByRole('button', { name: /Settings for tab "Safe"/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /Delete tab/ }),
    );
    const confirm = await screen.findByRole('dialog', { name: /Delete "Safe"\?/ });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect((await listTabs()).map((item) => item.title)).toEqual(['General', 'Safe']);
    expect(await countAllNotes()).toBe(2);
  });

  it('recreates a General tab when the last tab is deleted', async () => {
    // Start from a single tab by removing the seeded one first.
    const tabs = await listTabs();
    const { user } = await renderApp(tabs[0].id);

    await user.click(screen.getByRole('button', { name: /Settings for tab "General"/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /Delete tab/ }),
    );
    const confirm = await screen.findByRole('dialog', { name: /Delete "General"\?/ });
    await user.click(within(confirm).getByRole('button', { name: /Delete tab( and 1 notes)?/ }));

    // The user is never left with zero tabs.
    await waitFor(async () => {
      const remaining = await listTabs();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].title).toBe('General');
    });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
  });
});
