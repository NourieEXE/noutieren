import type { AppPreferences, ThemePreference } from '../types';
import { isValidId } from '../utils/id';
import { getBrowserApi } from './webext';
import { logError } from './errors';

/**
 * Small UI preferences live in `browser.storage.local` rather than IndexedDB:
 * they are tiny, read once at startup, and useful to observe across views.
 *
 * A `localStorage` fallback keeps `npm run dev` and unit tests working outside
 * an extension context.
 */

const STORAGE_KEY = 'preferences';

export const DEFAULT_PREFERENCES: AppPreferences = {
  selectedTabId: null,
  selectedNoteId: null,
  notesPanelCollapsed: false,
  theme: 'system',
  searchAllTabs: false,
};

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Coerces unknown stored data into a complete, valid preferences object. */
export function sanitizePreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFERENCES };
  const source = value as Record<string, unknown>;

  const theme = source.theme;
  return {
    selectedTabId: isValidId(source.selectedTabId) ? source.selectedTabId : null,
    selectedNoteId: isValidId(source.selectedNoteId) ? source.selectedNoteId : null,
    notesPanelCollapsed: source.notesPanelCollapsed === true,
    theme: THEMES.includes(theme as ThemePreference) ? (theme as ThemePreference) : 'system',
    searchAllTabs: source.searchAllTabs === true,
  };
}

/** Minimal surface the non-extension fallback needs. */
type FallbackStorage = Pick<Storage, 'getItem' | 'setItem'>;

// A storage key, so it keeps its pre-rename spelling for the same reason
// DATABASE_NAME does. Only used outside an extension context.
const FALLBACK_KEY = `colornote-tabs:${STORAGE_KEY}`;

function createMemoryStorage(): FallbackStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

let fallbackStorage: FallbackStorage | null = null;

/**
 * Resolves the storage used when the extension APIs are absent (`vite dev` and
 * unit tests).
 *
 * `localStorage` is probed rather than assumed: it can be present but unusable —
 * blocked by browser settings, or an accessor that yields nothing, as in jsdom.
 * An in-memory store is used in that case so writes are never silently dropped.
 */
function getFallbackStorage(): FallbackStorage {
  if (fallbackStorage) return fallbackStorage;
  try {
    const candidate = globalThis.localStorage as FallbackStorage | undefined;
    if (candidate && typeof candidate.getItem === 'function') {
      candidate.setItem(`${FALLBACK_KEY}:probe`, '1');
      fallbackStorage = candidate;
      return fallbackStorage;
    }
  } catch {
    // Unusable; fall through to memory.
  }
  fallbackStorage = createMemoryStorage();
  return fallbackStorage;
}

/** Replaces the fallback store. Only used by tests. */
export function __setFallbackStorageForTests(store: FallbackStorage | null): void {
  fallbackStorage = store;
}

function readFallback(): unknown {
  try {
    const raw = getFallbackStorage().getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeFallback(preferences: AppPreferences): void {
  try {
    getFallbackStorage().setItem(FALLBACK_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are convenience state; never let this break the app.
  }
}

export async function loadPreferences(): Promise<AppPreferences> {
  const api = getBrowserApi();
  if (!api) return sanitizePreferences(readFallback());

  try {
    const stored = await api.storage.local.get(STORAGE_KEY);
    return sanitizePreferences(stored[STORAGE_KEY]);
  } catch (error) {
    logError('loadPreferences', error);
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Merges a patch into the stored preferences and returns the new value. */
export async function savePreferences(
  current: AppPreferences,
  patch: Partial<AppPreferences>,
): Promise<AppPreferences> {
  const next = sanitizePreferences({ ...current, ...patch });
  const api = getBrowserApi();
  if (!api) {
    writeFallback(next);
    return next;
  }
  try {
    await api.storage.local.set({ [STORAGE_KEY]: next });
  } catch (error) {
    logError('savePreferences', error);
  }
  return next;
}

/**
 * Observes preference changes made by another view.
 *
 * Selection is intentionally *not* mirrored between views — two editors should
 * be able to sit on different notes — so callers apply only the fields they
 * want to follow (the theme, in practice).
 */
export function subscribeToPreferences(listener: (next: AppPreferences) => void): () => void {
  const api = getBrowserApi();
  if (!api) return () => undefined;

  const handler = (changes: Record<string, WebExtensionStorageChange>, areaName: string): void => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    listener(sanitizePreferences(change.newValue));
  };

  api.storage.onChanged.addListener(handler);
  return () => {
    api.storage.onChanged.removeListener(handler);
  };
}

interface WebExtensionStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}
