import { useId, useState } from 'react';
import { useWorkspace } from '../hooks/workspaceContext';
import { canPromptForPermission } from '../services/activeTabUrl';
import {
  reminderPresets,
  requestNotificationPermission,
  syncReminderAlarms,
} from '../services/reminders';
import { REMINDER_REPEAT_MINUTES } from '../services/preferences';
import { logError } from '../services/errors';
import { detectViewMode, openFullPageEditor } from '../services/webext';
import { formatReminderTime, toDateTimeLocal } from '../utils/time';
import type { NoteMeta } from '../types';
import { Dialog } from './Dialog';
import { Icon } from './Icons';

/** Mounted only while open, so the quick picks are worked out from when it opened. */
export function ReminderDialog({
  note,
  granted,
  onClose,
}: {
  note: NoteMeta;
  /** Whether notifications are allowed. */
  granted: boolean;
  onClose: () => void;
}) {
  const { actions, preferences, updatePreferences } = useWorkspace();
  const repeatId = useId();
  const [now] = useState(() => Date.now());
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const canPrompt = canPromptForPermission(detectViewMode());

  const set = (at: number | null) => {
    // Before anything is awaited: Firefox only shows the prompt from inside the click.
    if (at !== null && !granted && canPrompt) void requestNotificationPermission();
    void actions.setReminder(note.id, at);
    onClose();
  };

  const setCustomTime = () => {
    const at = new Date(custom).getTime();
    if (Number.isNaN(at)) setError('Pick a date and a time.');
    else if (at <= Date.now() + 60 * 1000) setError('Pick a time in the future.');
    else set(at);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reminder"
      description={`Get a notification about "${note.title}".`}
      footer={
        <>
          {note.remindAt !== undefined ? (
            <button type="button" className="button" onClick={() => set(null)}>
              Remove reminder
            </button>
          ) : null}
          <button type="button" className="button button--primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {note.remindAt !== undefined ? (
        <p className="dialog__note">
          <Icon name="bell" size={12} /> Set for {formatReminderTime(note.remindAt, now)}. Pick
          another time to change it.
        </p>
      ) : null}

      {granted ? null : (
        <div className="notice notice--warning reminder__notice">
          <Icon name="warning" />
          <div className="notice__body">
            <p className="notice__text">
              {canPrompt
                ? 'Reminders show as notifications, which need your permission. Noutieren asks when you set one.'
                : 'Reminders show as notifications, which need your permission. Chrome cannot ask from this popup, so this opens a tab that asks.'}
            </p>
            <button
              type="button"
              className="button button--compact"
              onClick={() => {
                if (canPrompt) void requestNotificationPermission();
                else void openFullPageEditor({ grant: 'reminders' });
              }}
            >
              Allow notifications
            </button>
          </div>
        </div>
      )}

      <ul className="option-list" aria-label="Quick picks">
        {reminderPresets(new Date(now)).map((preset) => (
          <li key={preset.label}>
            <button type="button" className="option-list__button" onClick={() => set(preset.at)}>
              <Icon name="bell" />
              {preset.label}
              <span className="option-list__hint">{formatReminderTime(preset.at, now)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="field reminder__custom">
        <label className="field__label" htmlFor={inputId}>
          Or pick a time
        </label>
        <div className="pin-add">
          <input
            id={inputId}
            className="input"
            type="datetime-local"
            value={custom}
            min={toDateTimeLocal(now)}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setCustom(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              setCustomTime();
            }}
          />
          <button
            type="button"
            className="button"
            disabled={custom.length === 0}
            onClick={setCustomTime}
          >
            Set
          </button>
        </div>
        {error ? (
          <p className="field__error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="field reminder__custom">
        <label className="field__label" htmlFor={repeatId}>
          If you miss it
        </label>
        <select
          id={repeatId}
          className="input"
          value={preferences.reminderRepeatMinutes}
          onChange={(event) => {
            const minutes = Number(event.target.value);
            updatePreferences({ reminderRepeatMinutes: minutes });
            syncReminderAlarms({ repeatMinutes: minutes }).catch((error: unknown) =>
              logError('syncReminderAlarms', error),
            );
          }}
        >
          {REMINDER_REPEAT_MINUTES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0
                ? 'Do not remind me again'
                : `Remind me again every ${minutes} minutes`}
            </option>
          ))}
        </select>
        <p className="field__hint">
          For every reminder. Stops after an hour, or when you open the note.
        </p>
      </div>
    </Dialog>
  );
}
