import { useSaveStatus } from '../hooks/useSaveStatus';
import { Icon } from './Icons';

const LABELS = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved',
} as const;

/**
 * Autosave indicator.
 *
 * A polite live region, so a screen reader hears "Saving…" / "Saved" without
 * interrupting typing. Failures also name the reason, and never claim the note
 * was stored.
 */
export function SaveStatus() {
  const status = useSaveStatus();
  const label = LABELS[status.state];

  return (
    <p
      className={`save-status save-status--${status.state}`}
      role="status"
      aria-live="polite"
      title={status.errorMessage ?? undefined}
    >
      {status.state === 'error' ? <Icon name="warning" size={14} /> : null}
      <span className="save-status__text">
        {status.state === 'error' && status.errorMessage
          ? `${label} — ${status.errorMessage}`
          : label}
      </span>
    </p>
  );
}
