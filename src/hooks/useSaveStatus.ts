import { useCallback, useSyncExternalStore } from 'react';
import { saveQueue, type SaveQueueStatus } from '../services/saveQueue';

/**
 * Subscribes to autosave status.
 *
 * `useSyncExternalStore` keeps re-renders to the indicator itself, so status
 * changes on every keystroke do not re-render the editor tree. The queue caches
 * its status object, which satisfies the hook's snapshot-stability contract.
 */
export function useSaveStatus(): SaveQueueStatus {
  const subscribe = useCallback((onChange: () => void) => saveQueue.subscribe(onChange), []);
  const getSnapshot = useCallback(() => saveQueue.getStatus(), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
