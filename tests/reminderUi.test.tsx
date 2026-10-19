import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Reminders as the user sets them. The editor is stubbed, as in workspaceActions. */
vi.mock('../src/editor/RichTextEditor', () => ({
  RichTextEditor: ({ noteId }: { noteId: string }) => (
    <div data-note-id={noteId} aria-label="Note content" />
  ),
}));

const { resetDatabase } = await import('./helpers');
const { App } = await import('../src/app/App');
const { WorkspaceProvider } = await import('../src/app/WorkspaceProvider');
const { ToastProvider } = await import('../src/components/ToastProvider');
const { DEFAULT_PREFERENCES } = await import('../src/services/preferences');
const { ensureSeeded } = await import('../src/services/workspaceService');
const { openDatabase } = await import('../src/database/db');
const { createTab } = await import('../src/database/tabsRepository');
const { createNote, getNote, setNoteReminder } = await import('../src/database/notesRepository');
const { getDatabase } = await import('../src/database/db');
const { reminderName, reminderPresets } = await import('../src/services/reminders');

const events = () => ({ addListener: vi.fn(), removeListener: vi.fn() });

/** An extension API with `alarms`, and `notifications` granted or not. */
function stubExtension({ notifications }: { notifications: boolean }) {
  const api = {
    runtime: { id: 'test-extension', getURL: (path: string) => `ext://noutieren/${path}` },
    permissions: {
      contains: vi.fn(({ permissions }: { permissions: string[] }) =>
        Promise.resolve(permissions.includes('notifications') ? notifications : false),
      ),
      request: vi.fn(() => Promise.resolve(false)),
      onAdded: events(),
      onRemoved: events(),
    },
    action: {
      setBadgeText: vi.fn(() => Promise.resolve()),
      setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
    },
    notifications: { clear: vi.fn(() => Promise.resolve(true)) },
    alarms: {
      create: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve(true)),
      getAll: vi.fn(() => Promise.resolve([])),
    },
    tabs: {
      create: vi.fn(() => Promise.resolve({})),
      query: vi.fn(() => Promise.resolve([])),
      onActivated: events(),
      onUpdated: events(),
    },
    windows: { onFocusChanged: events() },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
    },
  };
  vi.stubGlobal('chrome', api);
  return api;
}

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
  return { user };
}

async function openReminderDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Note actions' }));
  await user.click(await screen.findByRole('menuitem', { name: /Remind me|Edit reminder/ }));
  return screen.findByRole('dialog', { name: 'Reminder' });
}

beforeEach(async () => {
  await resetDatabase();
  await openDatabase();
  await ensureSeeded();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('setting a reminder', () => {
  it('sets one from a quick pick and schedules its alarm', async () => {
    const api = stubExtension({ notifications: true });
    const tab = await createTab({ title: 'Life' });
    const note = await createNote({ tabId: tab.id, title: 'Dentist' });
    const { user } = await renderApp(tab.id);

    const dialog = await openReminderDialog(user);
    const tomorrow = reminderPresets().find((preset) => preset.label === 'Tomorrow morning')!.at;
    await user.click(within(dialog).getByRole('button', { name: /Tomorrow morning/ }));

    await waitFor(async () => expect((await getNote(note.id))?.remindAt).toBe(tomorrow));
    // Scheduled after the write, so it is waited for as well.
    await waitFor(() =>
      expect(api.alarms.create).toHaveBeenCalledWith(reminderName(note.id), { when: tomorrow }),
    );
    expect(await screen.findByRole('button', { name: /^Tomorrow, / })).toBeInTheDocument();
    expect(screen.getByText('Reminder set.')).toBeInTheDocument();
    // Already allowed, so nothing is asked.
    expect(api.permissions.request).not.toHaveBeenCalled();
  });

  it('removes one, clearing its alarm', async () => {
    const api = stubExtension({ notifications: true });
    const tab = await createTab({ title: 'Life' });
    const note = await createNote({ tabId: tab.id, title: 'Dentist' });
    await setNoteReminder(note.id, Date.now() + 60 * 60 * 1000);
    api.alarms.getAll.mockResolvedValue([
      { name: reminderName(note.id), scheduledTime: 1 },
    ] as never);
    const { user } = await renderApp(tab.id);

    const dialog = await openReminderDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Remove reminder' }));

    await waitFor(async () => expect((await getNote(note.id))?.remindAt).toBeUndefined());
    await waitFor(() => expect(api.alarms.clear).toHaveBeenCalledWith(reminderName(note.id)));
    expect(await screen.findByText('Reminder removed.')).toBeInTheDocument();
  });

  it('refuses a custom time in the past', async () => {
    stubExtension({ notifications: true });
    const tab = await createTab({ title: 'Life' });
    const note = await createNote({ tabId: tab.id, title: 'Dentist' });
    const { user } = await renderApp(tab.id);

    const dialog = await openReminderDialog(user);
    const input = within(dialog).getByLabelText('Or pick a time');
    await user.type(input, '2020-01-01T09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Set' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick a time in the future.');
    expect((await getNote(note.id))?.remindAt).toBeUndefined();
  });
});

describe('the notifications permission', () => {
  it('is asked for in the sidebar when the first reminder is set, and the reminder is kept either way', async () => {
    const api = stubExtension({ notifications: false });
    const tab = await createTab({ title: 'Life' });
    const note = await createNote({ tabId: tab.id, title: 'Dentist' });
    const { user } = await renderApp(tab.id);

    const dialog = await openReminderDialog(user);
    await user.click(within(dialog).getByRole('button', { name: /In an hour/ }));

    expect(api.permissions.request).toHaveBeenCalledWith({ permissions: ['notifications'] });
    await waitFor(async () => expect((await getNote(note.id))?.remindAt).toBeDefined());
    expect(await screen.findByRole('button', { name: /notifications off/ })).toBeInTheDocument();
  });

  it('is handed to the full page from the Chrome popup, which cannot ask', async () => {
    window.history.replaceState(null, '', '/popup.html');
    const api = stubExtension({ notifications: false });
    const tab = await createTab({ title: 'Life' });
    await createNote({ tabId: tab.id, title: 'Dentist' });
    const { user } = await renderApp(tab.id);

    const dialog = await openReminderDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Allow notifications' }));

    expect(api.permissions.request).not.toHaveBeenCalled();
    expect(api.tabs.create).toHaveBeenCalledWith({
      url: 'ext://noutieren/index.html?view=page&grant=reminders',
    });
  });

  it('is asked for by the full page that the popup opened', async () => {
    window.history.replaceState(null, '', '/?view=page&grant=reminders');
    const api = stubExtension({ notifications: false });
    api.permissions.request.mockResolvedValue(true);
    const tab = await createTab({ title: 'Life' });
    const { user } = await renderApp(tab.id);

    const banner = screen.getByRole('region', { name: 'Allow notifications' });
    await user.click(within(banner).getByRole('button', { name: 'Allow notifications' }));

    expect(api.permissions.request).toHaveBeenCalledWith({ permissions: ['notifications'] });
    expect(await screen.findByText(/Notifications allowed/)).toBeInTheDocument();
  });
});

describe('opening a reminder', () => {
  it('opens the note the notification was for', async () => {
    const home = await createTab({ title: 'Home' });
    const work = await createTab({ title: 'Work' });
    await createNote({ tabId: home.id, title: 'Groceries' });
    const note = await createNote({ tabId: work.id, title: 'Send the invoice' });
    window.history.replaceState(null, '', `/?view=page&note=${note.id}`);

    await renderApp(home.id);

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Send the invoice'),
    );
  });
});

describe('seeing a reminder', () => {
  const MINUTE = 60 * 1000;

  async function noteThatWentOff(title: string, { shown = true } = {}) {
    const tab = await createTab({ title: 'Life' });
    const note = await createNote({ tabId: tab.id, title });
    const at = Date.now() - 10 * MINUTE;
    await setNoteReminder(note.id, at);
    if (shown) await getDatabase().notes.update(note.id, { reminderShownAt: at });
    return { tab, note };
  }

  it('happens when its note is opened, which stops the repeats and clears the badge', async () => {
    const api = stubExtension({ notifications: true });
    const { tab, note } = await noteThatWentOff('Dentist');

    await renderApp(tab.id);

    await waitFor(async () => expect((await getNote(note.id))?.remindAt).toBeUndefined());
    // The badge is the last step, so once it is cleared the rest has run.
    await waitFor(() => expect(api.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' }));
    expect(api.notifications.clear).toHaveBeenCalledWith(reminderName(note.id));
  });

  it('does not happen in a tab that is not on screen', async () => {
    stubExtension({ notifications: true });
    const { tab, note } = await noteThatWentOff('Dentist');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    await renderApp(tab.id);
    await screen.findByRole('textbox', { name: 'Note title' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await getNote(note.id))?.remindAt).toBeDefined();
    visibility.mockRestore();
  });

  it('happens on opening a due note when notifications are off, since it never went off', async () => {
    stubExtension({ notifications: false });
    const { tab, note } = await noteThatWentOff('Dentist', { shown: false });

    await renderApp(tab.id);

    await waitFor(async () => expect((await getNote(note.id))?.remindAt).toBeUndefined());
  });

  it('is still waiting for other notes, whose bells say so', async () => {
    stubExtension({ notifications: true });
    const tab = await createTab({ title: 'Life' });
    // First in the list, so it is the one that opens.
    await createNote({ tabId: tab.id, title: 'Open one' });
    const waiting = await createNote({ tabId: tab.id, title: 'Waiting' });
    const at = Date.now() - 10 * MINUTE;
    await setNoteReminder(waiting.id, at);
    await getDatabase().notes.update(waiting.id, { reminderShownAt: at });

    await renderApp(tab.id);

    expect(await screen.findByText('Reminder due.')).toBeInTheDocument();
    expect((await getNote(waiting.id))?.remindAt).toBe(at);
  });
});

describe('the repeat setting', () => {
  it('is saved and reschedules the alarms', async () => {
    const api = stubExtension({ notifications: true });
    const tab = await createTab({ title: 'Life' });
    await createNote({ tabId: tab.id, title: 'Dentist' });
    const { user } = await renderApp(tab.id);

    const dialog = await openReminderDialog(user);
    const select = within(dialog).getByLabelText('If you miss it');
    expect(select).toHaveValue('5');
    await user.selectOptions(select, 'Remind me again every 10 minutes');

    await waitFor(() =>
      expect(api.storage.local.set).toHaveBeenCalledWith({
        preferences: expect.objectContaining({ reminderRepeatMinutes: 10 }) as unknown,
      }),
    );
    await waitFor(() => expect(api.alarms.getAll).toHaveBeenCalled());
  });
});
