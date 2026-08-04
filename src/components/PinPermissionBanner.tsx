import { useState } from 'react';
import { requestTabsPermission } from '../services/activeTabUrl';
import { wantsPinPermissionGrant } from '../services/webext';
import { Icon } from './Icons';

/**
 * The landing strip for a full-page tab opened to grant the pin permission.
 *
 * Chrome cannot raise a permission dialog from its toolbar popup, so the popup
 * opens this view instead. Arriving here has to *mean* something: without an
 * explicit prompt the tab just looks like the editor opening for no reason,
 * with the request never made — which is precisely how it behaved before this
 * existed.
 *
 * The grant is a click, not an effect on mount. Browsers require a user gesture
 * for `permissions.request()`, and a page that asked for a permission the
 * instant it loaded would deserve to be refused anyway.
 */
export function PinPermissionBanner({ granted }: { granted: boolean }) {
  // Read once. The flag describes why this document was opened, and that does
  // not change while it is open.
  const [requested] = useState(() => wantsPinPermissionGrant());
  const [outcome, setOutcome] = useState<'idle' | 'granted' | 'denied'>('idle');

  if (!requested) return null;

  // Already held — either granted a moment ago, or before this tab opened.
  if (granted || outcome === 'granted') {
    return (
      <div className="banner banner--ok" role="status">
        <Icon name="check" />
        <span>
          Access granted. <strong>Pin to URL</strong> now works — you can close this tab and go back
          to the popup.
        </span>
      </div>
    );
  }

  return (
    <div className="banner" role="region" aria-label="Enable Pin to URL">
      <Icon name="pin" />
      <div className="banner__body">
        <p className="banner__text">
          <strong>Enable Pin to URL.</strong> Noutieren needs permission to read the address of the
          tab you are on, so it can tell which pins match. The address is compared in memory and
          never stored or sent.
          {outcome === 'denied'
            ? ' The request was declined — your pins are still saved, they just do nothing yet.'
            : ' Chrome cannot ask for this from the toolbar popup, which is why it opened this tab.'}
        </p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void requestTabsPermission().then((ok) => setOutcome(ok ? 'granted' : 'denied'));
          }}
        >
          {outcome === 'denied' ? 'Try again' : 'Grant access'}
        </button>
      </div>
    </div>
  );
}
