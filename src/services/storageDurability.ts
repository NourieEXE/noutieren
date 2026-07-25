import { logError } from './errors';

/**
 * Storage durability.
 *
 * By default a browser origin's storage is "best effort": Firefox may evict it
 * when the disk comes under pressure. For a notes application that is the
 * difference between a cache and a filing cabinet, so this asks for the
 * `persistent` bucket, which is exempt from automatic eviction.
 *
 * `unlimitedStorage` in the manifest lifts the quota ceiling, which is a
 * separate question from eviction. Requesting persistence explicitly costs one
 * call and removes the ambiguity.
 */

export type PersistenceState = 'persisted' | 'denied' | 'unsupported' | 'error';

/**
 * Ensures the origin's storage is persistent, requesting it if it is not
 * already granted. Never throws: durability is important, but not a reason to
 * stop the application from starting.
 */
export async function ensurePersistentStorage(): Promise<PersistenceState> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (
    !storage ||
    typeof storage.persist !== 'function' ||
    typeof storage.persisted !== 'function'
  ) {
    return 'unsupported';
  }

  try {
    if (await storage.persisted()) return 'persisted';
    // Extensions holding `unlimitedStorage` are granted this without a prompt.
    return (await storage.persist()) ? 'persisted' : 'denied';
  } catch (error) {
    logError('ensurePersistentStorage', error);
    return 'error';
  }
}

/** Bytes used and available, when the browser will say. For diagnostics. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage || typeof storage.estimate !== 'function') return null;
  try {
    const estimate = await storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch (error) {
    logError('storageEstimate', error);
    return null;
  }
}

/** How long a backup may go stale before the reminder appears. */
export const EXPORT_REMINDER_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether to nudge the user to export a backup.
 *
 * Deliberately conservative: nothing is said until there is real work to lose,
 * and never on a workspace that has only the seeded note. A user who has never
 * exported is measured from when they first wrote something, not from epoch, so
 * a fresh install stays quiet for its first few weeks.
 */
export function shouldRemindToExport(input: {
  lastExportedAt: number | null;
  noteCount: number;
  oldestNoteCreatedAt: number | null;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  if (input.noteCount < 2) return false;

  const since = input.lastExportedAt ?? input.oldestNoteCreatedAt;
  if (since === null || !Number.isFinite(since) || since > now) return false;

  return now - since >= EXPORT_REMINDER_DAYS * DAY_MS;
}

/** Human-readable age of the last backup, for the settings menu. */
export function describeLastExport(lastExportedAt: number | null, now = Date.now()): string {
  if (lastExportedAt === null) return 'No backup exported yet';
  const days = Math.floor((now - lastExportedAt) / DAY_MS);
  if (days <= 0) return 'Backed up today';
  if (days === 1) return 'Backed up yesterday';
  return `Backed up ${days} days ago`;
}
