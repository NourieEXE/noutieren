import { useEffect, useState } from 'react';
import { subscribeToActiveUrl, type ActiveUrlState } from '../services/activeTabUrl';

/**
 * The active tab's URL for as long as a view is mounted. Starts as "not
 * granted", which is where every user is until their first pin.
 */
export function useActiveUrl(): ActiveUrlState {
  const [state, setState] = useState<ActiveUrlState>({ url: null, granted: false });

  useEffect(() => subscribeToActiveUrl(setState), []);

  return state;
}
