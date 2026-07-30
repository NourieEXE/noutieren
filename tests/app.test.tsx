import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDatabase } from './helpers';
import { App } from '../src/app/App';
import { WorkspaceProvider } from '../src/app/WorkspaceProvider';
import { ToastProvider } from '../src/components/ToastProvider';
import { DEFAULT_PREFERENCES } from '../src/services/preferences';
import { ensureSeeded } from '../src/services/workspaceService';
import { openDatabase } from '../src/database/db';
import { createTab } from '../src/database/tabsRepository';
import { createNote } from '../src/database/notesRepository';
import { doc } from './helpers';
import type { AppPreferences } from '../src/types';

async function renderApp(preferences: Partial<AppPreferences> = {}) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <WorkspaceProvider initialPreferences={{ ...DEFAULT_PREFERENCES, ...preferences }}>
        <App />
      </WorkspaceProvider>
    </ToastProvider>,
  );
  // Wait until the live queries have delivered tabs and the notes for the
  // selected tab, and the editor (or an empty state) has settled. The editor
  // appears one tick later because its document is read separately.
  await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.queryByText(/Loading your notes/)).toBeNull());
  await waitFor(() =>
    expect(
      screen.queryByRole('group', { name: 'Formatting' }) ??
        screen.queryByText(/no notes yet|No note selected/i),
    ).not.toBeNull(),
  );
  return { user };
}

function notesList() {
  return screen.getByRole('list', { name: 'Notes' });
}

beforeEach(async () => {
  await resetDatabase();
  await openDatabase();
  // Seed first, so tabs a test creates afterwards are additional to General.
  await ensureSeeded();
});

describe('first run', () => {
  it('shows one General tab holding one blank note, both selected', async () => {
    await renderApp();

    const tab = screen.getByRole('tab', { name: /General/ });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAccessibleName(/1 note/);

    const rows = within(notesList()).getAllByRole('listitem');
    expect(rows).toHaveLength(1);

    // The seeded note is selected by an effect that runs after the live query
    // delivers it, a tick later than the list itself — so this has to be waited
    // for rather than read straight after render.
    await waitFor(() =>
      expect(within(rows[0]).getByRole('button')).toHaveAttribute('aria-current', 'true'),
    );
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('New note');
  });

  it('renders the editor with its formatting toolbar', async () => {
    await renderApp();

    const toolbar = await screen.findByRole('group', { name: 'Formatting' });
    for (const label of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Paragraph',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'Checklist',
      'Block quote',
      'Code block',
      'Add link',
      'Remove link',
      'Clear formatting',
      'Undo',
      'Redo',
    ]) {
      expect(within(toolbar).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('disables commands that cannot run yet', async () => {
    await renderApp();
    const toolbar = await screen.findByRole('group', { name: 'Formatting' });
    // Nothing has been typed, so there is no history and no link to remove.
    expect(within(toolbar).getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Remove link' })).toBeDisabled();
  });

  it('offers the full-page editor from the sidebar', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: /Full page/ })).toBeInTheDocument();
  });
});

describe('creating notes and tabs', () => {
  it('creates a note with the New note button and selects it', async () => {
    const { user } = await renderApp();

    await user.click(screen.getByRole('button', { name: /^New note$/ }));

    await waitFor(() => {
      expect(within(notesList()).getAllByRole('listitem')).toHaveLength(2);
    });
    // The newly created note is the selected one.
    const selected = within(notesList())
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'true');
    expect(selected).toHaveLength(1);
  });

  it('creates a note with Ctrl+N', async () => {
    const { user } = await renderApp();

    await user.keyboard('{Control>}n{/Control}');

    await waitFor(() => {
      expect(within(notesList()).getAllByRole('listitem')).toHaveLength(2);
    });
  });

  it('creates a tab with the New tab button and selects it', async () => {
    const { user } = await renderApp();

    await user.click(screen.getByRole('button', { name: /New tab/ }));

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });
    const newTab = screen.getByRole('tab', { name: /New tab/ });
    expect(newTab).toHaveAttribute('aria-selected', 'true');
    // A brand-new tab has no notes, and says so.
    expect(await screen.findByText(/This tab has no notes yet/)).toBeInTheDocument();
  });

  it('creates a tab with Ctrl+Shift+N', async () => {
    const { user } = await renderApp();
    await user.keyboard('{Control>}{Shift>}n{/Shift}{/Control}');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
  });
});

describe('tab navigation', () => {
  it('moves focus with arrow keys and selects with Enter', async () => {
    const { user } = await renderApp();
    await createTab({ title: 'Second' });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));

    const first = screen.getByRole('tab', { name: /General/ });
    first.focus();
    await user.keyboard('{ArrowRight}');

    const second = screen.getByRole('tab', { name: /Second/ });
    expect(second).toHaveFocus();
    // Manual activation: focus moved but selection has not.
    expect(second).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(second).toHaveAttribute('aria-selected', 'true'));
  });

  it('shows a note count on every tab', async () => {
    const second = await createTab({ title: 'Second' });
    await createNote({ tabId: second.id });
    await createNote({ tabId: second.id });
    await renderApp();

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Second/ })).toHaveAccessibleName(/2 notes/),
    );
  });
});

describe('search', () => {
  it('filters the list as the user types and reports the count', async () => {
    const tab = await createTab({ title: 'Notes' });
    await createNote({ tabId: tab.id, title: 'Alpha', content: doc('first body') });
    await createNote({ tabId: tab.id, title: 'Beta', content: doc('second body') });
    const { user } = await renderApp({ selectedTabId: tab.id });

    await waitFor(() => expect(within(notesList()).getAllByRole('listitem')).toHaveLength(2));

    await user.type(screen.getByRole('searchbox', { name: /Search notes/ }), 'second');

    await waitFor(() => {
      const rows = within(notesList()).getAllByRole('listitem');
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText('Beta')).toBeInTheDocument();
    });
    expect(screen.getByText(/1 result in this tab/)).toBeInTheDocument();
  });

  it('shows a useful message when nothing matches', async () => {
    const { user } = await renderApp();
    await user.type(screen.getByRole('searchbox', { name: /Search notes/ }), 'zzzznothing');
    expect(await screen.findByText(/No notes match/)).toBeInTheDocument();
    expect(screen.getByText(/Try “All tabs”/)).toBeInTheDocument();
  });

  it('searches every tab when asked, and shows which tab a result is in', async () => {
    const other = await createTab({ title: 'Archive' });
    await createNote({ tabId: other.id, title: 'Hidden gem', content: doc('needle here') });
    const { user } = await renderApp();

    await user.type(screen.getByRole('searchbox', { name: /Search notes/ }), 'needle');
    await waitFor(() => expect(screen.getByText(/No notes match/)).toBeInTheDocument());

    await user.click(screen.getByRole('checkbox', { name: /All tabs/ }));

    await waitFor(() => {
      expect(within(notesList()).getByText('Hidden gem')).toBeInTheDocument();
    });
    // Global results are labelled with their tab.
    expect(within(notesList()).getByText('Archive')).toBeInTheDocument();
  });

  it('selects the right tab and note when a global result is chosen', async () => {
    const other = await createTab({ title: 'Archive' });
    await createNote({ tabId: other.id, title: 'Hidden gem', content: doc('needle here') });
    const { user } = await renderApp({ searchAllTabs: true });

    await user.type(screen.getByRole('searchbox', { name: /Search notes/ }), 'needle');
    const result = await within(notesList()).findByText('Hidden gem');
    await user.click(result);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Archive/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Hidden gem');
    });
  });

  it('focuses the search box with Ctrl+K', async () => {
    const { user } = await renderApp();
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: /Search notes/ })).toHaveFocus(),
    );
  });
});

describe('notes panel collapse', () => {
  it('hides and restores the notes list', async () => {
    const { user } = await renderApp();
    expect(notesList()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide the notes list' }));

    await waitFor(() => expect(screen.queryByRole('list', { name: 'Notes' })).toBeNull());
    // The editor is still there, now using the whole area.
    expect(screen.getByRole('textbox', { name: 'Note title' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show the notes list' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Notes' })).toBeInTheDocument());
  });

  it('starts collapsed when the preference says so', async () => {
    await renderApp({ notesPanelCollapsed: true });
    expect(screen.queryByRole('list', { name: 'Notes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the notes list' })).toBeInTheDocument();
  });
});

describe('themes', () => {
  it('applies an explicit theme choice to the document', async () => {
    await renderApp({ theme: 'dark' });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('switches theme from the settings menu', async () => {
    const { user } = await renderApp({ theme: 'dark' });

    await user.click(screen.getByRole('button', { name: 'Settings and data' }));
    await user.click(screen.getByRole('menuitem', { name: /Light/ }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });
});

describe('help', () => {
  it('documents the shortcuts in a dialog', async () => {
    const { user } = await renderApp();

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ctrl/Cmd + N')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl/Cmd + Shift + N')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl/Cmd + K')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl/Cmd + S')).toBeInTheDocument();
  });
});
