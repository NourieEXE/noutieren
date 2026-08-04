import { useEffect, useState } from 'react';
import { subscribeToActiveUrl, type ActiveUrlState } from '../services/activeTabUrl';

/**
 * Subscribes to the active tab's URL for as long as a view is mounted.
 *
 * Starts as "not granted, no URL", which is the state every user is in until
 * they create their first pin, and is also the state the app must behave
 * correctly in forever if they never do.
 */
export function useActiveUrl(): ActiveUrlState {
  const [state, setState] = useState<ActiveUrlState>({ url: null, granted: false });

  useEffect(() => subscribeToActiveUrl(setState), []);

  return state;
}
