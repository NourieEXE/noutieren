/**
 * Reminders: a time stored on the note, an alarm per reminder, and a
 * notification when it goes off.
 *
 * `alarms` is a required permission: Firefox does not allow it as an optional
 * one, and it shows no prompt anyway. `notifications` is optional and asked
 * for when the first reminder is set, like `tabs` for pins. Without it,
 * reminders are kept and shown once it is granted.
 *
 * A reminder that has gone off stays until it is seen: its note is opened, its
 * notification clicked or dismissed, or the reminder removed. Until then it
 * goes off again every `reminderRepeatMinutes`, for up to an hour, and the
 * toolbar badge counts it.
 *
 * The database is the source of truth. Alarms do not survive a Firefox
 * restart, so the background rebuilds them on startup.
 */

import type * as WebExtension from 'webextension-polyfill';
import type { NoteMeta } from '../types';
import { listReminders, setNoteReminder } from '../database/notesRepository';
import { getBrowserApi, type BrowserApi } from './webext';
import { loadPreferences } from './preferences';
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

const MINUTE_MS = 60 * 1000;

/** Alarms can fire a little early; this much early still counts. */
const TOLERANCE_MS = MINUTE_MS;

/** Repeats stop this long after the reminder was due. The badge stays. */
export const REPEAT_WINDOW_MS = 60 * MINUTE_MS;

const BADGE_COLOR = '#b3261e';

export function isReminderDue(note: NoteMeta, now: number): boolean {
  return note.remindAt !== undefined && note.remindAt <= now + TOLERANCE_MS;
}

/**
 * When the reminder should next go off: `null` for never again, a time at or
 * before `now` for straight away.
 */
export function nextReminderTime(
  note: NoteMeta,
  now: number,
  repeatMinutes: number,
): number | null {
  if (note.remindAt === undefined) return null;
  if (!isReminderDue(note, now)) return note.remindAt;
  if (note.reminderShownAt === undefined) return now;
  if (repeatMinutes <= 0) return null;
  const next = note.reminderShownAt + repeatMinutes * MINUTE_MS;
  return next > note.remindAt + REPEAT_WINDOW_MS ? null : next;
}

export function shouldShowReminder(note: NoteMeta, now: number, repeatMinutes: number): boolean {
  if (!isReminderDue(note, now)) return false;
  const next = nextReminderTime(note, now, repeatMinutes);
  return next !== null && next <= now + TOLERANCE_MS;
}

async function repeatSetting(repeatMinutes: number | undefined): Promise<number> {
  return repeatMinutes ?? (await loadPreferences()).reminderRepeatMinutes;
}

/**
 * Makes the alarms match the stored reminders: one per reminder that will go
 * off later, none for anything else. Returns the ids that should go off now,
 * which only the background acts on.
 */
export async function syncReminderAlarms({
  api = getBrowserApi(),
  now = Date.now(),
  repeatMinutes,
}: { api?: BrowserApi | null; now?: number; repeatMinutes?: number } = {}): Promise<string[]> {
  const repeat = await repeatSetting(repeatMinutes);
  const due: string[] = [];
  const wanted = new Map<string, number>();
  for (const note of await listReminders()) {
    const next = nextReminderTime(note, now, repeat);
    if (next === null) continue;
    if (next <= now) due.push(note.id);
    else wanted.set(reminderName(note.id), next);
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

/** Puts the number of reminders waiting to be seen on the toolbar button. */
export async function refreshReminderBadge(
  api: BrowserApi | null = getBrowserApi(),
  now = Date.now(),
): Promise<void> {
  const action = api?.action;
  if (!action) return;
  const waiting = (await listReminders()).filter((note) => isReminderDue(note, now)).length;
  await action.setBadgeText({ text: waiting === 0 ? '' : waiting > 9 ? '9+' : String(waiting) });
  if (waiting > 0) await action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

/** The reminder has been seen: stop repeating it and take it off the badge. */
export async function acknowledgeReminder(
  noteId: string,
  api: BrowserApi | null = getBrowserApi(),
): Promise<void> {
  await setNoteReminder(noteId, null);
  await api?.notifications?.clear(reminderName(noteId));
  await syncReminderAlarms({ api });
  await refreshReminderBadge(api);
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
