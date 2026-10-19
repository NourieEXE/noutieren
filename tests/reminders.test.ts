import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from './helpers';
import { createTab } from '../src/database/tabsRepository';
import {
  createNote,
  deleteNote,
  duplicateNote,
  getNote,
  listReminders,
  setNoteReminder,
  markReminderShown,
} from '../src/database/notesRepository';
import { restoreFromTrash } from '../src/database/trashRepository';
import { parseBackup } from '../src/services/backupService';
import { getDatabase } from '../src/database/db';
import {
  nextReminderTime,
  noteIdFromReminderName,
  refreshReminderBadge,
  reminderName,
  reminderPresets,
  shouldShowReminder,
  syncReminderAlarms,
} from '../src/services/reminders';
import type { NoteMeta } from '../src/types';
import {
  catchUpOnReminders,
  installReminderHandlers,
  openReminder,
  showReminder,
} from '../src/background/reminders';
import {
  fullPagePath,
  requestedGrant,
  requestedNoteId,
  type BrowserApi,
} from '../src/services/webext';
import { formatReminderTime } from '../src/utils/time';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await resetDatabase();
});

async function seedNote(title = 'Call the dentist') {
  const tab = await createTab({ title: 'Life' });
  return createNote({ tabId: tab.id, title });
}

/** The slice of the extension API reminders use, recording what they do with it. */
function fakeApi({ notifications = true } = {}) {
  const alarms = new Map<string, number>();
  const on = {
    alarm: [] as ((alarm: { name: string }) => void)[],
    click: [] as ((id: string) => void)[],
    added: [] as (() => void)[],
    startup: [] as (() => void)[],
    installed: [] as (() => void)[],
    closed: [] as ((id: string, byUser: boolean) => void)[],
  };
  const notificationsApi = {
    create: vi.fn((id: string) => Promise.resolve(id)),
    clear: vi.fn(() => Promise.resolve(true)),
    onClicked: { addListener: (listener: (id: string) => void) => on.click.push(listener) },
    onClosed: {
      addListener: (listener: (id: string, byUser: boolean) => void) => on.closed.push(listener),
    },
  };
  const raw = {
    runtime: {
      getURL: (path: string) => `ext://noutieren/${path}`,
      onStartup: { addListener: (listener: () => void) => on.startup.push(listener) },
      onInstalled: { addListener: (listener: () => void) => on.installed.push(listener) },
    },
    alarms: {
      create: vi.fn((name: string, info: { when: number }) => {
        alarms.set(name, info.when);
        return Promise.resolve();
      }),
      clear: vi.fn((name: string) => Promise.resolve(alarms.delete(name))),
      getAll: vi.fn(() =>
        Promise.resolve([...alarms].map(([name, scheduledTime]) => ({ name, scheduledTime }))),
      ),
      onAlarm: {
        addListener: (listener: (alarm: { name: string }) => void) => on.alarm.push(listener),
      },
    },
    notifications: notifications ? notificationsApi : undefined,
    permissions: { onAdded: { addListener: (listener: () => void) => on.added.push(listener) } },
    tabs: { create: vi.fn(() => Promise.resolve({})) },
    action: {
      setBadgeText: vi.fn(() => Promise.resolve()),
      setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
    },
  };
  return { api: raw as unknown as BrowserApi, raw, alarms, on, notificationsApi };
}

describe('quick picks', () => {
  // A Wednesday.
  const wednesday = new Date(2026, 8, 23, 10, 0);

  it('offers an hour from now, this evening, tomorrow morning and next Monday', () => {
    expect(reminderPresets(wednesday)).toEqual([
      { label: 'In an hour', at: wednesday.getTime() + HOUR },
      { label: 'This evening', at: new Date(2026, 8, 23, 18, 0).getTime() },
      { label: 'Tomorrow morning', at: new Date(2026, 8, 24, 9, 0).getTime() },
      { label: 'Next week', at: new Date(2026, 8, 28, 9, 0).getTime() },
    ]);
  });

  it('leaves out this evening once it is nearly evening', () => {
    const labels = reminderPresets(new Date(2026, 8, 23, 17, 30)).map((preset) => preset.label);
    expect(labels).not.toContain('This evening');
  });

  it('takes next week to mean the Monday after, even on a Monday or a Sunday', () => {
    const nextWeek = (date: Date) => reminderPresets(date).find((p) => p.label === 'Next week')!.at;
    expect(nextWeek(new Date(2026, 8, 28, 10, 0))).toBe(new Date(2026, 9, 5, 9, 0).getTime());
    expect(nextWeek(new Date(2026, 8, 27, 10, 0))).toBe(new Date(2026, 8, 28, 9, 0).getTime());
  });
});

describe('how a reminder time reads', () => {
  const now = new Date(2026, 8, 23, 10, 0).getTime();

  it('says today, tomorrow and yesterday, then the weekday, then the date', () => {
    expect(formatReminderTime(new Date(2026, 8, 23, 18, 0).getTime(), now)).toMatch(/^Today, /);
    expect(formatReminderTime(new Date(2026, 8, 24, 9, 0).getTime(), now)).toMatch(/^Tomorrow, /);
    expect(formatReminderTime(new Date(2026, 8, 22, 9, 0).getTime(), now)).toMatch(/^Yesterday, /);

    const saturday = new Date(2026, 8, 26, 9, 0);
    const weekday = saturday.toLocaleDateString(undefined, { weekday: 'short' });
    expect(formatReminderTime(saturday.getTime(), now)).toMatch(new RegExp(`^${weekday}, `));

    expect(formatReminderTime(new Date(2027, 0, 5, 9, 0).getTime(), now)).toContain('2027');
  });
});

describe('storing a reminder', () => {
  it('sets and clears it without counting as an edit', async () => {
    const note = await seedNote();
    const at = Date.now() + DAY;

    expect((await setNoteReminder(note.id, at))?.remindAt).toBe(at);
    expect((await getNote(note.id))?.updatedAt).toBe(note.updatedAt);

    await getDatabase().notes.update(note.id, { reminderShownAt: at });
    await setNoteReminder(note.id, null);
    const cleared = (await getNote(note.id))!;
    expect('remindAt' in cleared).toBe(false);
    expect('reminderShownAt' in cleared).toBe(false);
    expect(await setNoteReminder('missing', at)).toBeUndefined();
  });

  it('lists notes with a reminder, soonest first', async () => {
    const tab = await createTab({ title: 'Life' });
    const later = await createNote({ tabId: tab.id, title: 'Later' });
    const sooner = await createNote({ tabId: tab.id, title: 'Sooner' });
    await createNote({ tabId: tab.id, title: 'None' });
    await setNoteReminder(later.id, Date.now() + DAY);
    await setNoteReminder(sooner.id, Date.now() + HOUR);

    expect((await listReminders()).map((note) => note.title)).toEqual(['Sooner', 'Later']);
  });

  it('is not copied onto a duplicate', async () => {
    const note = await seedNote();
    await setNoteReminder(note.id, Date.now() + DAY);

    const copy = await duplicateNote(note.id);

    expect(copy?.remindAt).toBeUndefined();
  });

  it('survives Recently deleted if still ahead, and is dropped if it came due meanwhile', async () => {
    const tab = await createTab({ title: 'Life' });
    const future = await createNote({ tabId: tab.id, title: 'Future' });
    const past = await createNote({ tabId: tab.id, title: 'Past' });
    const at = Date.now() + DAY;
    await setNoteReminder(future.id, at);
    await setNoteReminder(past.id, Date.now() + MINUTE);
    await deleteNote(future.id);
    await deleteNote(past.id);
    await getDatabase().trash.update(past.id, { 'meta.remindAt': Date.now() - HOUR });

    expect((await restoreFromTrash(future.id))?.remindAt).toBe(at);
    expect((await restoreFromTrash(past.id))?.remindAt).toBeUndefined();
  });

  it('is kept by an import only when it is still ahead', () => {
    const now = Date.now();
    const note = (id: string, remindAt: unknown) => ({
      id,
      tabId: 'tab',
      title: id,
      content: { type: 'doc', content: [] },
      remindAt,
    });
    const parsed = parseBackup(
      JSON.stringify({
        formatVersion: 1,
        tabs: [{ id: 'tab', title: 'Tab' }],
        notes: [note('ahead', now + DAY), note('behind', now - DAY), note('junk', 'soon')],
      }),
    );

    expect(parsed.notes.map((item) => [item.id, item.remindAt])).toEqual([
      ['ahead', now + DAY],
      ['behind', undefined],
      ['junk', undefined],
    ]);
  });
});

describe('when a reminder goes off', () => {
  const at = new Date(2026, 8, 23, 9, 0).getTime();
  const note = (shownAt?: number): NoteMeta => ({
    id: 'n',
    tabId: 't',
    title: 'Note',
    color: '#64748b',
    plainText: '',
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    remindAt: at,
    ...(shownAt === undefined ? {} : { reminderShownAt: shownAt }),
  });

  it('goes off at its time, then again every few minutes for an hour', () => {
    expect(nextReminderTime(note(), at - HOUR, 5)).toBe(at);
    expect(shouldShowReminder(note(), at - HOUR, 5)).toBe(false);
    expect(shouldShowReminder(note(), at, 5)).toBe(true);

    expect(shouldShowReminder(note(at), at + 2 * MINUTE, 5)).toBe(false);
    expect(nextReminderTime(note(at), at + 2 * MINUTE, 5)).toBe(at + 5 * MINUTE);
    expect(shouldShowReminder(note(at), at + 5 * MINUTE, 5)).toBe(true);

    expect(nextReminderTime(note(at + 55 * MINUTE), at + 56 * MINUTE, 5)).toBe(at + HOUR);
    expect(nextReminderTime(note(at + HOUR), at + HOUR, 5)).toBeNull();
  });

  it('goes off once when repeats are off', () => {
    expect(shouldShowReminder(note(), at, 0)).toBe(true);
    expect(nextReminderTime(note(at), at + 10 * MINUTE, 0)).toBeNull();
  });

  it('records the time, once per turn', async () => {
    const seeded = await seedNote();
    const now = Date.now();
    await setNoteReminder(seeded.id, now - MINUTE);
    const show = (candidate: NoteMeta) => shouldShowReminder(candidate, now, 5);

    expect(await markReminderShown(seeded.id, now, show)).toBeDefined();
    expect(await getNote(seeded.id)).toMatchObject({
      remindAt: now - MINUTE,
      reminderShownAt: now,
    });
    expect(await markReminderShown(seeded.id, now, show)).toBeUndefined();
  });

  it('ignores a note that has been deleted', async () => {
    const seeded = await seedNote();
    await setNoteReminder(seeded.id, Date.now() - MINUTE);
    await deleteNote(seeded.id);

    expect(await markReminderShown(seeded.id, Date.now(), () => true)).toBeUndefined();
  });
});

describe('keeping alarms in step', () => {
  it('schedules future reminders, clears stale alarms, and reports the due ones', async () => {
    const tab = await createTab({ title: 'Life' });
    const due = await createNote({ tabId: tab.id, title: 'Due' });
    const ahead = await createNote({ tabId: tab.id, title: 'Ahead' });
    const now = Date.now();
    await setNoteReminder(due.id, now - MINUTE);
    await setNoteReminder(ahead.id, now + DAY);

    const { api, alarms } = fakeApi();
    alarms.set(reminderName('removed-note'), now + HOUR);
    alarms.set(reminderName(ahead.id), now + HOUR);
    alarms.set('something-else', now + HOUR);

    expect(await syncReminderAlarms({ api, now, repeatMinutes: 5 })).toEqual([due.id]);
    expect(Object.fromEntries(alarms)).toEqual({
      [reminderName(ahead.id)]: now + DAY,
      'something-else': now + HOUR,
    });
  });

  it('schedules the next repeat of one that went off, until the hour is up', async () => {
    const tab = await createTab({ title: 'Life' });
    const repeating = await createNote({ tabId: tab.id, title: 'Repeating' });
    const finished = await createNote({ tabId: tab.id, title: 'Finished' });
    const now = Date.now();
    await setNoteReminder(repeating.id, now - 10 * MINUTE);
    await getDatabase().notes.update(repeating.id, { reminderShownAt: now - 2 * MINUTE });
    await setNoteReminder(finished.id, now - 2 * HOUR);
    await getDatabase().notes.update(finished.id, { reminderShownAt: now - 61 * MINUTE });
    const { api, alarms } = fakeApi();

    expect(await syncReminderAlarms({ api, now, repeatMinutes: 5 })).toEqual([]);
    expect(Object.fromEntries(alarms)).toEqual({
      [reminderName(repeating.id)]: now + 3 * MINUTE,
    });
  });

  it('still reports due reminders where there is no alarms API', async () => {
    const note = await seedNote();
    await setNoteReminder(note.id, Date.now() - MINUTE);

    expect(await syncReminderAlarms({ api: null, repeatMinutes: 5 })).toEqual([note.id]);
  });

  it('round-trips a note id through the alarm name', () => {
    expect(noteIdFromReminderName(reminderName('abc-123'))).toBe('abc-123');
    expect(noteIdFromReminderName('reminder:')).toBeNull();
    expect(noteIdFromReminderName('other')).toBeNull();
  });
});

describe('the toolbar badge', () => {
  it('counts the reminders waiting to be seen', async () => {
    const tab = await createTab({ title: 'Life' });
    const now = Date.now();
    for (const [title, at] of [
      ['Missed', now - HOUR],
      ['Just now', now],
      ['Later', now + HOUR],
    ] as const) {
      const note = await createNote({ tabId: tab.id, title });
      await setNoteReminder(note.id, at);
    }
    const { api, raw } = fakeApi();

    await refreshReminderBadge(api, now);

    expect(raw.action.setBadgeText).toHaveBeenCalledWith({ text: '2' });
    expect(raw.action.setBadgeBackgroundColor).toHaveBeenCalled();
  });

  it('is empty when nothing is waiting', async () => {
    const { api, raw } = fakeApi();
    await refreshReminderBadge(api);
    expect(raw.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});

describe('showing a reminder', () => {
  it('shows the note title but never its text, and keeps the reminder until it is seen', async () => {
    const tab = await createTab({ title: 'Life' });
    const note = await createNote({
      tabId: tab.id,
      title: 'Call the dentist',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ask about Friday' }] }],
      },
    });
    const now = Date.now();
    await setNoteReminder(note.id, now);
    const { api, notificationsApi } = fakeApi();

    expect(await showReminder(api, note.id, now, 5)).toBe(true);
    expect(notificationsApi.create).toHaveBeenCalledWith(reminderName(note.id), {
      type: 'basic',
      iconUrl: 'ext://noutieren/icons/icon-128.png',
      title: 'Call the dentist',
      message: 'Reminder',
    });
    expect(await getNote(note.id)).toMatchObject({ remindAt: now, reminderShownAt: now });
  });

  it('says when it was due if it is shown late', async () => {
    const note = await seedNote();
    const now = Date.now();
    await setNoteReminder(note.id, now - 3 * HOUR);
    const { api, notificationsApi } = fakeApi();

    await showReminder(api, note.id, now, 5);

    const [, options] = notificationsApi.create.mock.calls[0] as unknown as [
      string,
      { message: string },
    ];
    expect(options.message).toMatch(/^Due /);
  });

  it('holds it back without the notifications permission', async () => {
    const note = await seedNote();
    const at = Date.now() - MINUTE;
    await setNoteReminder(note.id, at);
    const { api } = fakeApi({ notifications: false });

    expect(await showReminder(api, note.id, Date.now(), 5)).toBe(false);
    expect((await getNote(note.id))?.reminderShownAt).toBeUndefined();
    expect((await getNote(note.id))?.remindAt).toBe(at);
  });

  it('catches up on start: shows what came due, schedules the rest, counts it on the badge', async () => {
    const tab = await createTab({ title: 'Life' });
    const missed = await createNote({ tabId: tab.id, title: 'Missed' });
    const ahead = await createNote({ tabId: tab.id, title: 'Ahead' });
    const now = Date.now();
    await setNoteReminder(missed.id, now - 10 * MINUTE);
    await setNoteReminder(ahead.id, now + HOUR);
    const { api, raw, alarms, notificationsApi } = fakeApi();

    await catchUpOnReminders(api, now, 5);

    expect(notificationsApi.create).toHaveBeenCalledTimes(1);
    expect(notificationsApi.create.mock.calls[0][0]).toBe(reminderName(missed.id));
    expect(Object.fromEntries(alarms)).toEqual({
      [reminderName(missed.id)]: now + 5 * MINUTE,
      [reminderName(ahead.id)]: now + HOUR,
    });
    expect(raw.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });

  it('counts clicking the notification as seeing it, and opens the note', async () => {
    const note = await seedNote();
    await setNoteReminder(note.id, Date.now() - MINUTE);
    const { api, raw, notificationsApi } = fakeApi();

    await openReminder(api, reminderName(note.id));

    expect((await getNote(note.id))?.remindAt).toBeUndefined();
    expect(notificationsApi.clear).toHaveBeenCalledWith(reminderName(note.id));
    expect(raw.tabs.create).toHaveBeenCalledWith({
      url: `ext://noutieren/index.html?view=page&note=${note.id}`,
    });
    expect(raw.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('ignores clicks on anything that is not a reminder', async () => {
    const { api, raw } = fakeApi();
    await openReminder(api, 'not-a-reminder');
    expect(raw.tabs.create).not.toHaveBeenCalled();
  });
});

describe('background wiring', () => {
  it('shows a reminder when its alarm goes off', async () => {
    const note = await seedNote();
    await setNoteReminder(note.id, Date.now());
    const { api, on, notificationsApi } = fakeApi();

    installReminderHandlers(api);
    on.alarm.forEach((listener) => listener({ name: reminderName(note.id) }));

    await vi.waitFor(() => expect(notificationsApi.create).toHaveBeenCalledTimes(1));
  });

  it('counts a notification the user dismissed as seen, but not one that closed by itself', async () => {
    const note = await seedNote();
    await setNoteReminder(note.id, Date.now() - MINUTE);
    const { api, on } = fakeApi();
    installReminderHandlers(api);

    on.closed.forEach((listener) => listener(reminderName(note.id), false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await getNote(note.id))?.remindAt).toBeDefined();

    on.closed.forEach((listener) => listener(reminderName(note.id), true));
    await vi.waitFor(async () => expect((await getNote(note.id))?.remindAt).toBeUndefined());
  });

  it('starts listening to notifications, and shows what was held back, once they are allowed', async () => {
    const note = await seedNote();
    await setNoteReminder(note.id, Date.now() - MINUTE);
    const { api, raw, on, notificationsApi } = fakeApi({ notifications: false });

    installReminderHandlers(api);
    expect(on.click).toHaveLength(0);

    (raw as { notifications?: unknown }).notifications = notificationsApi;
    on.added.forEach((listener) => listener());

    expect(on.click).toHaveLength(1);
    expect(on.closed).toHaveLength(1);
    await vi.waitFor(() => expect(notificationsApi.create).toHaveBeenCalledTimes(1));
  });
});

describe('full-page links', () => {
  it('builds and reads the grant and note parameters', () => {
    expect(fullPagePath()).toBe('index.html?view=page');
    expect(fullPagePath({ grant: 'reminders' })).toBe('index.html?view=page&grant=reminders');
    expect(fullPagePath({ noteId: 'abc-123' })).toBe('index.html?view=page&note=abc-123');

    expect(requestedGrant('?view=page&grant=reminders')).toBe('reminders');
    expect(requestedGrant('?grant=everything')).toBeNull();
    expect(requestedNoteId('?view=page&note=abc-123')).toBe('abc-123');
    expect(requestedNoteId('?note=<script>')).toBeNull();
  });
});
