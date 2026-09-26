import { useState } from 'react';
import { requestTabsPermission } from '../services/activeTabUrl';
import { requestNotificationPermission } from '../services/reminders';
import { requestedGrant, type GrantReason } from '../services/webext';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { Icon } from './Icons';

const COPY: Record<
  GrantReason,
  { label: string; ask: string; declined: string; granted: string; button: string }
> = {
  pins: {
    label: 'Enable Pin to URL',
    ask: 'Noutieren needs permission to read the address of the tab you are on, so it can tell which pins match. The address is compared in memory and never stored or sent.',
    declined: 'The request was declined. Your pins are still saved, they just do nothing yet.',
    granted: 'Access granted. Pin to URL now works',
    button: 'Grant access',
  },
  reminders: {
    label: 'Allow notifications',
    ask: 'Reminders show as a notification, which needs your permission.',
    declined:
      'The request was declined. Your reminders are still saved, they just cannot show yet.',
    granted: 'Notifications allowed. Reminders now show',
    button: 'Allow notifications',
  },
};

/**
 * Shown on a full-page tab opened to ask for a permission. Chrome cannot raise
 * the dialog from its popup, so the popup opens this view, and arriving here
 * has to explain itself. The request is a click, since browsers require one.
 */
export function PermissionBanner({ pinsGranted }: { pinsGranted: boolean }) {
  // Read once. The flag says why this document was opened.
  const [reason] = useState(() => requestedGrant());
  const [outcome, setOutcome] = useState<'idle' | 'granted' | 'denied'>('idle');
  const notificationsGranted = useNotificationPermission();

  if (!reason) return null;
  const copy = COPY[reason];
  const granted = reason === 'pins' ? pinsGranted : notificationsGranted;

  if (granted || outcome === 'granted') {
    return (
      <div className="banner banner--ok" role="status">
        <Icon name="check" />
        <span>{copy.granted}, so you can close this tab and go back to the popup.</span>
      </div>
    );
  }

  return (
    <div className="banner" role="region" aria-label={copy.label}>
      <Icon name={reason === 'pins' ? 'pin' : 'bell'} />
      <div className="banner__body">
        <p className="banner__text">
          <strong>{copy.label}.</strong> {copy.ask}{' '}
          {outcome === 'denied'
            ? copy.declined
            : 'Chrome cannot ask for this from the toolbar popup, which is why it opened this tab.'}
        </p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            const request =
              reason === 'pins' ? requestTabsPermission() : requestNotificationPermission();
            void request.then((ok) => setOutcome(ok ? 'granted' : 'denied'));
          }}
        >
          {outcome === 'denied' ? 'Try again' : copy.button}
        </button>
      </div>
    </div>
  );
}
