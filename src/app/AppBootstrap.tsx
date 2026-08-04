import { useCallback, useEffect, useState } from 'react';
import type { AppPreferences } from '../types';
import { openDatabase } from '../database/db';
import { ensureSeeded } from '../services/workspaceService';
import { loadPreferences, subscribeToPreferences } from '../services/preferences';
import { describeError, logError, logWarning } from '../services/errors';
import { ensurePersistentStorage } from '../services/storageDurability';
import { WorkspaceProvider } from './WorkspaceProvider';
import { App } from './App';

type BootstrapState =
  | { status: 'loading' }
  | { status: 'ready'; preferences: AppPreferences }
  | { status: 'error'; message: string };

/**
 * Opens IndexedDB, runs first-run seeding and loads preferences before the
 * workspace mounts, so no component has to cope with a half-initialised
 * database.
 */
export function AppBootstrap() {
  const [state, setState] = useState<BootstrapState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await openDatabase();
        await ensureSeeded();
        // Ask for eviction-exempt storage before the user writes anything.
        // Failure is not fatal: notes still save, they are just evictable.
        void ensurePersistentStorage().then((state) => {
          // Chrome always answers `denied` for extension origins, so this is a
          // normal condition there rather than a fault — `unlimitedStorage`
          // governs eviction instead. Logged at `debug` (see `logWarning`) so
          // it does not land in Chrome's extension "Errors" panel, which
          // collects `console.warn` and would show this on every launch, in
          // every context, as though something had gone wrong. The `error`
          // state has already been logged with its cause by the service itself.
          if (state === 'denied' || state === 'unsupported') {
            logWarning(
              'storage durability',
              `persistent storage was not granted (${state}); relying on unlimitedStorage`,
            );
          }
        });
        const preferences = await loadPreferences();
        if (!cancelled) setState({ status: 'ready', preferences });
      } catch (error) {
        logError('bootstrap', error);
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Theme changes made in another view apply here too; selection deliberately
  // does not, so two windows can sit on different notes.
  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    return subscribeToPreferences((next) => {
      setState((current) =>
        current.status === 'ready' && current.preferences.theme !== next.theme
          ? { status: 'ready', preferences: { ...current.preferences, theme: next.theme } }
          : current,
      );
    });
  }, [state.status]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  if (state.status === 'loading') {
    return (
      <p className="app__loading" role="status">
        Opening your notes…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="fatal">
        <h1 className="fatal__title">Local storage is unavailable</h1>
        <p>{state.message}</p>
        <p>
          Noutieren keeps everything in this browser profile’s IndexedDB. This usually fails when
          storage is blocked for extensions, the disk is full, or the profile is read-only.
        </p>
        <div className="fatal__actions">
          <button type="button" className="button button--primary" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceProvider initialPreferences={state.preferences}>
      <App />
    </WorkspaceProvider>
  );
}
