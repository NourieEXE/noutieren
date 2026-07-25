import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPORT_REMINDER_DAYS,
  describeLastExport,
  ensurePersistentStorage,
  shouldRemindToExport,
  storageEstimate,
} from '../src/services/storageDurability';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 25);

/** Installs a fake `navigator.storage` for one test. */
function stubStorage(value: unknown) {
  Object.defineProperty(navigator, 'storage', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

describe('ensurePersistentStorage', () => {
  it('does not ask again when storage is already persistent', async () => {
    const persist = vi.fn();
    stubStorage({ persisted: () => Promise.resolve(true), persist });

    expect(await ensurePersistentStorage()).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('requests persistence when it has not been granted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: () => Promise.resolve(false), persist });

    expect(await ensurePersistentStorage()).toBe('persisted');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal rather than pretending it worked', async () => {
    stubStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) });
    expect(await ensurePersistentStorage()).toBe('denied');
  });

  it('reports unsupported browsers instead of throwing', async () => {
    stubStorage(undefined);
    expect(await ensurePersistentStorage()).toBe('unsupported');

    stubStorage({});
    expect(await ensurePersistentStorage()).toBe('unsupported');
  });

  it('never propagates an error out of the startup path', async () => {
    stubStorage({
      persisted: () => Promise.reject(new Error('denied by policy')),
      persist: () => Promise.resolve(true),
    });
    await expect(ensurePersistentStorage()).resolves.toBe('error');
  });
});

describe('storageEstimate', () => {
  it('returns usage and quota when available', async () => {
    stubStorage({ estimate: () => Promise.resolve({ usage: 1234, quota: 99999 }) });
    expect(await storageEstimate()).toEqual({ usage: 1234, quota: 99999 });
  });

  it('returns null when unsupported or failing', async () => {
    stubStorage({});
    expect(await storageEstimate()).toBeNull();

    stubStorage({ estimate: () => Promise.reject(new Error('nope')) });
    expect(await storageEstimate()).toBeNull();
  });
});

describe('shouldRemindToExport', () => {
  const base = {
    lastExportedAt: null as number | null,
    noteCount: 10,
    oldestNoteCreatedAt: NOW - 60 * DAY,
    now: NOW,
  };

  it('nags when a workspace with real content has never been backed up', () => {
    expect(shouldRemindToExport(base)).toBe(true);
  });

  it('stays quiet on a workspace that is essentially empty', () => {
    expect(shouldRemindToExport({ ...base, noteCount: 1 })).toBe(false);
    expect(shouldRemindToExport({ ...base, noteCount: 0 })).toBe(false);
  });

  it('stays quiet on a fresh install, measuring from the first note', () => {
    expect(shouldRemindToExport({ ...base, oldestNoteCreatedAt: NOW - 2 * DAY })).toBe(false);
  });

  it('stays quiet after a recent backup, however old the notes are', () => {
    expect(shouldRemindToExport({ ...base, lastExportedAt: NOW - 3 * DAY })).toBe(false);
  });

  it('nags again once the last backup goes stale', () => {
    const stale = NOW - (EXPORT_REMINDER_DAYS + 1) * DAY;
    expect(shouldRemindToExport({ ...base, lastExportedAt: stale })).toBe(true);
  });

  it('treats the threshold itself as due', () => {
    const exactly = NOW - EXPORT_REMINDER_DAYS * DAY;
    expect(shouldRemindToExport({ ...base, lastExportedAt: exactly })).toBe(true);
    expect(shouldRemindToExport({ ...base, lastExportedAt: exactly + 1 })).toBe(false);
  });

  it('ignores nonsense timestamps rather than nagging on every launch', () => {
    expect(shouldRemindToExport({ ...base, lastExportedAt: NOW + 10 * DAY })).toBe(false);
    expect(shouldRemindToExport({ ...base, lastExportedAt: Number.NaN })).toBe(false);
    expect(shouldRemindToExport({ ...base, oldestNoteCreatedAt: null })).toBe(false);
  });
});

describe('describeLastExport', () => {
  it('describes the age of the last backup', () => {
    expect(describeLastExport(null)).toBe('No backup exported yet');
    expect(describeLastExport(NOW, NOW)).toBe('Backed up today');
    expect(describeLastExport(NOW - DAY, NOW)).toBe('Backed up yesterday');
    expect(describeLastExport(NOW - 9 * DAY, NOW)).toBe('Backed up 9 days ago');
  });
});
