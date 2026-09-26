import { takeDueReminder } from '../database/notesRepository';
import { previewText } from '../editor/document';
import { logError } from '../services/errors';
import { noteIdFromReminderName, reminderName, syncReminderAlarms } from '../services/reminders';
import { fullPagePath, type BrowserApi } from '../services/webext';
import { formatReminderTime } from '../utils/time';

/** Later than this and the notification says when it was due. */
const LATE_MS = 5 * 60 * 1000;

/**
 * Shows a due reminder and clears it. Without the notifications permission it
 * is left due, and shown once the permission is granted.
 */
export async function showReminder(
  api: BrowserApi,
  noteId: string,
  now = Date.now(),
): Promise<boolean> {
  if (!api.notifications) return false;
  const note = await takeDueReminder(noteId, now);
  if (note?.remindAt === undefined) return false;

  const preview = previewText(note.plainText, 120);
  const late = now - note.remindAt > LATE_MS;
  await api.notifications.create(reminderName(note.id), {
    type: 'basic',
    iconUrl: api.runtime.getURL('icons/icon-128.png'),
    title: note.title,
    message: late
      ? `Due ${formatReminderTime(note.remindAt, now)}.${preview ? ` ${preview}` : ''}`
      : preview || 'Reminder',
  });
  return true;
}

/** Rebuilds the alarms and shows whatever came due while nothing was running. */
export async function catchUpOnReminders(api: BrowserApi, now = Date.now()): Promise<void> {
  for (const noteId of await syncReminderAlarms(api, now)) {
    await showReminder(api, noteId, now);
  }
}

/** Opens the note in the full-page view. A notification cannot open the sidebar. */
export async function openReminder(api: BrowserApi, notificationId: string): Promise<void> {
  const noteId = noteIdFromReminderName(notificationId);
  if (!noteId) return;
  await api.notifications.clear(notificationId);
  await api.tabs.create({ url: api.runtime.getURL(fullPagePath({ noteId })) });
}

/**
 * Wires reminders into a background context: Firefox's event page or
 * Chrome's service worker. Listeners are added synchronously, which is what
 * lets an alarm wake either one.
 */
export function installReminderHandlers(api: BrowserApi): void {
  const report = (context: string) => (error: unknown) => logError(context, error);
  const catchUp = () => void catchUpOnReminders(api).catch(report('reminders.catchUp'));

  api.runtime.onStartup.addListener(catchUp);
  api.runtime.onInstalled.addListener(catchUp);

  api.alarms.onAlarm.addListener((alarm) => {
    const noteId = noteIdFromReminderName(alarm.name);
    if (noteId) void showReminder(api, noteId).catch(report('reminders.show'));
  });

  // `notifications` only exists once granted, so its listener may have to
  // wait for the grant. Granting also shows anything that was held back.
  let listening = false;
  const listenForClicks = () => {
    if (listening || !api.notifications) return;
    listening = true;
    api.notifications.onClicked.addListener((id) => {
      void openReminder(api, id).catch(report('reminders.open'));
    });
  };
  listenForClicks();
  api.permissions.onAdded.addListener(() => {
    listenForClicks();
    catchUp();
  });
}
