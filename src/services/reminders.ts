/**
 * Reminders: a time stored on the note, an alarm per reminder, and a
 * notification when it goes off.
 *
 * `alarms` is a required permission: Firefox does not allow it as an optional
 * one, and it shows no prompt anyway. `notifications` is optional and asked
 * for when the first reminder is set, like `tabs` for pins. Without it,
 * reminders are kept and shown once it is granted.
 *
 * The database is the source of truth. Alarms do not survive a Firefox
 * restart, so the background rebuilds them on startup.
 */

import type * as WebExtension from 'webextension-polyfill';
import { listReminders } from '../database/notesRepository';
import { getBrowserApi, type BrowserApi } from './webext';
import { logError } from './errors';

const NOTIFICATIONS: WebExtension.Permissions.Permissions = { permissions: ['notifications'] };

const PREFIX = 'reminder:';

/** Used for both the alarm and the notification, so either leads back to the note. */
export function reminderName(noteId: string): string {
  return `${PREFIX}${noteId}`;
}

export function noteIdFromReminderName(name: string): string | null {
  return name.startsWith(PREFIX) && name.length > PREFIX.length ? name.slice(PREFIX.length) : null;
}

export async function hasNotificationPermission(): Promise<boolean> {
  const api = getBrowserApi();
  if (!api?.permissions) return false;
  try {
    return await api.permissions.contains(NOTIFICATIONS);
  } catch (error) {
    logError('hasNotificationPermission', error);
    return false;
  }
}

/** Call straight from a click, with nothing awaited first, or Firefox refuses. */
export function requestNotificationPermission(): Promise<boolean> {
  const api = getBrowserApi();
  if (!api?.permissions) return Promise.resolve(false);
  return api.permissions.request(NOTIFICATIONS).catch((error: unknown) => {
    logError('requestNotificationPermission', error);
    return false;
  });
}

export function subscribeToNotificationPermission(
  listener: (granted: boolean) => void,
): () => void {
  const api = getBrowserApi();
  let cancelled = false;
  const refresh = () => {
    void hasNotificationPermission().then((granted) => {
      if (!cancelled) listener(granted);
    });
  };
  api?.permissions?.onAdded.addListener(refresh);
  api?.permissions?.onRemoved.addListener(refresh);
  refresh();
  return () => {
    cancelled = true;
    api?.permissions?.onAdded.removeListener(refresh);
    api?.permissions?.onRemoved.removeListener(refresh);
  };
}

/**
 * Makes the alarms match the stored reminders: one per future reminder, none
 * for anything else. Returns the ids of reminders already due, which only the
 * background acts on.
 */
export async function syncReminderAlarms(
  api: BrowserApi | null = getBrowserApi(),
  now = Date.now(),
): Promise<string[]> {
  const due: string[] = [];
  const wanted = new Map<string, number>();
  for (const note of await listReminders()) {
    if (note.remindAt === undefined) continue;
    if (note.remindAt <= now) due.push(note.id);
    else wanted.set(reminderName(note.id), note.remindAt);
  }

  const alarms = api?.alarms;
  if (!alarms) return due;

  for (const alarm of await alarms.getAll()) {
    if (noteIdFromReminderName(alarm.name) === null) continue;
    if (wanted.get(alarm.name) === alarm.scheduledTime) wanted.delete(alarm.name);
    else if (!wanted.has(alarm.name)) await alarms.clear(alarm.name);
  }
  for (const [name, when] of wanted) await alarms.create(name, { when });
  return due;
}

export interface ReminderPreset {
  label: string;
  at: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** The quick picks in the reminder dialog. */
export function reminderPresets(now = new Date()): ReminderPreset[] {
  const at = (days: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date.getTime();
  };
  const presets: ReminderPreset[] = [{ label: 'In an hour', at: now.getTime() + HOUR_MS }];
  if (now.getHours() < 17) presets.push({ label: 'This evening', at: at(0, 18) });
  presets.push({ label: 'Tomorrow morning', at: at(1, 9) });
  // Next Monday, a full week away when today is Monday.
  presets.push({ label: 'Next week', at: at((8 - now.getDay()) % 7 || 7, 9) });
  return presets;
}
