import { useEffect, useState } from 'react';
import {
  clearPendingUpdate,
  installedVersion,
  subscribeToPendingUpdate,
} from '../services/whatsNew';
import { openFullPageEditor } from '../services/webext';
import { logError } from '../services/errors';
import { Icon } from './Icons';

/** "Updated to x.y.z", once, after an update. */
export function UpdateNotice() {
  const [pending, setPending] = useState(false);
  useEffect(() => subscribeToPendingUpdate(setPending), []);

  if (!pending) return null;

  const dismiss = () => {
    setPending(false);
    clearPendingUpdate().catch((error: unknown) => logError('clearPendingUpdate', error));
  };

  return (
    <div className="update-notice" role="status">
      <span>Noutieren was updated to {installedVersion()}.</span>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          dismiss();
          void openFullPageEditor({ show: 'whats-new' });
        }}
      >
        See what's new
      </button>
      <button
        type="button"
        className="icon-button icon-button--small update-notice__close"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
