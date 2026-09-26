import { useEffect, useState } from 'react';
import { subscribeToNotificationPermission } from '../services/reminders';

/** Whether reminders can show. Follows grants and revocations while mounted. */
export function useNotificationPermission(): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => subscribeToNotificationPermission(setGranted), []);
  return granted;
}
