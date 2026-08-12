import { useId, useState } from 'react';
import {
  describePattern,
  normalizeMatchPattern,
  parsePattern,
  widenToPrefix,
  MAX_PATTERNS_PER_PIN,
} from '../utils/matchPattern';
import { Icon } from './Icons';

/**
 * The "Pin to URL" editor, shared by tab settings and note settings.
 *
 * Nothing is widened silently: a wildcard comes only from the checkbox, and the
 * exact string that will be saved is printed before it is added.
 *
 * Saving is the caller's job, since it reports the whole new list on every
 * change.
 */
export function PinToUrlField({
  patterns,
  activeUrl,
  granted,
  onChange,
  onRequestPermission,
  label,
  description,
}: {
  patterns: readonly string[];
  activeUrl: string | null;
  granted: boolean;
  onChange: (patterns: string[]) => void;
  onRequestPermission: () => Promise<'granted' | 'denied' | 'elsewhere'>;
  label: string;
  description: string;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wildcard, setWildcard] = useState(false);
  const [sentToFullPage, setSentToFullPage] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const wildcardId = useId();

  const atLimit = patterns.length >= MAX_PATTERNS_PER_PIN;

  const add = (raw: string): void => {
    const trimmed = wildcard ? widenToPrefix(raw) : raw.trim();
    if (trimmed.length === 0) return;

    const result = parsePattern(trimmed);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    if (patterns.includes(result.pattern.source)) {
      setError('That pattern is already in the list.');
      return;
    }
    if (atLimit) {
      setError(`A pin can hold at most ${MAX_PATTERNS_PER_PIN} patterns.`);
      return;
    }

    setError(null);
    setDraft('');
    onChange([...patterns, result.pattern.source]);
  };

  const remove = (source: string): void => {
    setError(null);
    onChange(patterns.filter((pattern) => pattern !== source));
  };

  // Origin plus pathname, not the raw URL: a one-click suggestion rarely wants
  // the query string, and that is the fiddly part to type if it does.
  const rawSuggestion = activeUrl ? suggestFromUrl(activeUrl) : null;
  const suggestion = rawSuggestion
    ? normalizeMatchPattern(wildcard ? widenToPrefix(rawSuggestion) : rawSuggestion)
    : null;

  const preview = normalizeMatchPattern(wildcard ? widenToPrefix(draft) : draft.trim());

  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <p className="field__hint">{description}</p>

      {patterns.length > 0 ? (
        <ul className="pin-list">
          {patterns.map((pattern) => (
            <li key={pattern} className="pin-list__item">
              <Icon name="pin" />
              <span className="pin-list__text">
                <code className="pin-list__pattern">{pattern}</code>
                <span className="pin-list__description">{describePattern(pattern)}</span>
              </span>
              <button
                type="button"
                className="icon-button icon-button--small"
                onClick={() => remove(pattern)}
                aria-label={`Remove pin ${pattern}`}
                title="Remove"
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pin-list__empty">Not pinned, always visible.</p>
      )}

      <div className="pin-add">
        <input
          id={inputId}
          className="input"
          value={draft}
          placeholder="https://*.youtube.com/*"
          aria-label={`${label}: add a URL pattern`}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          disabled={atLimit}
          maxLength={2048}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add(draft);
          }}
        />
        <button
          type="button"
          className="button"
          disabled={draft.trim().length === 0 || atLimit}
          onClick={() => add(draft)}
        >
          Add
        </button>
      </div>

      <label className="checkbox" htmlFor={wildcardId}>
        <input
          id={wildcardId}
          type="checkbox"
          checked={wildcard}
          disabled={atLimit}
          onChange={(event) => {
            setWildcard(event.target.checked);
            if (error) setError(null);
          }}
        />
        Also match everything under this address
      </label>

      {preview ? (
        <p className="field__hint">
          Will be saved as <code className="pin-list__pattern">{preview}</code>:{' '}
          {describePattern(preview)}.
        </p>
      ) : null}

      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}

      {suggestion && !patterns.includes(suggestion) && !atLimit ? (
        <button type="button" className="button button--compact" onClick={() => add(suggestion)}>
          <Icon name="plus" />
          Use this page: {describePattern(suggestion)}
        </button>
      ) : null}

      {/* Pins save either way, so this reports what they are doing, not a gate. */}
      {!granted && patterns.length > 0 ? (
        <div className="notice notice--warning">
          <Icon name="warning" />
          <div className="notice__body">
            <p className="notice__text">
              {sentToFullPage
                ? 'Opened the full page. Grant access there, then come back to this popup.'
                : 'These pins are saved but not active yet. Noutieren needs permission to read the address of the tab you are on. It is compared in memory and never stored or sent.'}
            </p>
            {sentToFullPage ? null : (
              <button
                type="button"
                className="button button--primary button--compact"
                onClick={() => {
                  void onRequestPermission().then((outcome) => {
                    setSentToFullPage(outcome === 'elsewhere');
                  });
                }}
              >
                <Icon name="pin" />
                Enable Pin to URL
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The current page as a starting pattern. No wildcard: that is the checkbox. */
function suggestFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // `hostname`, not `host`: patterns have no port syntax.
  return normalizeMatchPattern(`${parsed.protocol}//${parsed.hostname}${parsed.pathname}`);
}
