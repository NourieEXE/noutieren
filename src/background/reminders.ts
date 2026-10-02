import { markReminderShown } from '../database/notesRepository';
import { previewText } from '../editor/document';
import { logError } from '../services/errors';
import { loadPreferences } from '../services/preferences';
import {
  acknowledgeReminder,
  noteIdFromReminderName,
  refreshReminderBadge,
  reminderName,
  shouldShowReminder,
  syncReminderAlarms,
} from '../services/reminders';
import { fullPagePath, type BrowserApi } from '../services/webext';
import { formatReminderTime } from '../utils/time';

/** Later than this and the notification says when it was due. */
const LATE_MS = 5 * 60 * 1000;

/**
 * Shows a reminder that should go off now. Without the notifications
 * permission nothing is recorded, so it goes off once the permission is
 * granted; the badge counts it either way.
 */
export async function showReminder(
  api: BrowserApi,
  noteId: string,
  now: number,
  repeatMinutes: number,
): Promise<boolean> {
  if (!api.notifications) return false;
  const note = await markReminderShown(noteId, now, (candidate) =>
    shouldShowReminder(candidate, now, repeatMinutes),
  );
  if (note?.remindAt === undefined) return false;

  const name = reminderName(note.id);
  const preview = previewText(note.plainText, 120);
  const late = now - note.remindAt > LATE_MS;
  // Cleared first, so a repeat alerts again instead of quietly replacing it.
  await api.notifications.clear(name);
  await api.notifications.create(name, {
    type: 'basic',
    iconUrl: api.runtime.getURL('icons/icon-128.png'),
    title: note.title,
    message: late
      ? `Due ${formatReminderTime(note.remindAt, now)}.${preview ? ` ${preview}` : ''}`
      : preview || 'Reminder',
  });
  return true;
}

/**
 * Shows whatever should go off now, schedules the rest, and updates the
 * badge. Runs on startup, on every reminder alarm, and when notifications are
 * allowed.
 */
export async function catchUpOnReminders(
  api: BrowserApi,
  now = Date.now(),
  repeatMinutes?: number,
): Promise<void> {
  const repeat = repeatMinutes ?? (await loadPreferences()).reminderRepeatMinutes;
  const due = await syncReminderAlarms({ api, now, repeatMinutes: repeat });
  let shown = false;
  for (const noteId of due) {
    if (await showReminder(api, noteId, now, repeat)) shown = true;
  }
  // Those just shown now have a repeat to schedule.
  if (shown) await syncReminderAlarms({ api, now, repeatMinutes: repeat });
  await refreshReminderBadge(api, now);
}

/** Clicking a notification counts as seeing it, and opens the note. */
export async function openReminder(api: BrowserApi, notificationId: string): Promise<void> {
  const noteId = noteIdFromReminderName(notificationId);
  if (!noteId) return;
  await acknowledgeReminder(noteId, api);
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
    if (noteIdFromReminderName(alarm.name)) catchUp();
  });

  // `notifications` only exists once granted, so its listeners may have to
  // wait for the grant. Granting also shows anything that was held back.
  let listening = false;
  const listenToNotifications = () => {
    if (listening || !api.notifications) return;
    listening = true;
    api.notifications.onClicked.addListener((id) => {
      void openReminder(api, id).catch(report('reminders.open'));
    });
    // Dismissed by the user counts as seen. Firefox does not say who closed
    // one, and closes them on its own after a few seconds, so only `true` counts.
    api.notifications.onClosed.addListener((id, byUser) => {
      const noteId = noteIdFromReminderName(id);
      if (noteId && byUser === true) {
        void acknowledgeReminder(noteId, api).catch(report('reminders.dismiss'));
      }
    });
  };
  listenToNotifications();
  api.permissions.onAdded.addListener(() => {
    listenToNotifications();
    catchUp();
  });
}
