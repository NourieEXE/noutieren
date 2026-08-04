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
 * Patterns are added one at a time and listed back in their normalized form, so
 * what is stored and what the user reads are the same string.
 *
 * Nothing is widened silently. A wildcard is added only by the checkbox, and the
 * exact pattern that will be saved is printed under the field before it is
 * added — an earlier version completed a missing path to `/*` during parsing,
 * which meant `https://www.youtube.com/` came back covering the whole site. A
 * pin that is broader than the one someone typed is the one kind of surprise
 * this field must not produce.
 *
 * The component is deliberately uncontrolled with respect to saving: it reports
 * the whole new list on every change and lets the caller persist it, because
 * saving a pin can require a permission prompt and only the caller knows how to
 * report a refusal.
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
  /** The current page, offered as a one-click starting point. */
  activeUrl: string | null;
  /** Whether the `tabs` permission is held. Pins are inert without it. */
  granted: boolean;
  onChange: (patterns: string[]) => void;
  /** Raises the permission dialog, or diverts to a surface that can. */
  onRequestPermission: () => Promise<'granted' | 'denied' | 'elsewhere'>;
  label: string;
  description: string;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Off by default: nothing is ever widened unless it is asked for here.
  const [wildcard, setWildcard] = useState(false);
  // Set when the request was handed to the full-page view, so the notice can
  // say where the prompt went instead of appearing to have done nothing.
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

  // Offered as `origin + pathname`, not the raw URL: pinning to the exact
  // address including its query string is rarely what someone wants from a
  // one-click suggestion, and it is the fiddly part to type by hand if it is.
  // The wildcard option applies to it too, so both routes behave the same.
  const rawSuggestion = activeUrl ? suggestFromUrl(activeUrl) : null;
  const suggestion = rawSuggestion
    ? normalizeMatchPattern(wildcard ? widenToPrefix(rawSuggestion) : rawSuggestion)
    : null;

  // What the current draft would actually be stored as. Null while the draft is
  // empty or not yet valid, so it never contradicts the error message.
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
        <p className="pin-list__empty">Not pinned — always visible.</p>
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

      {/*
        The exact string that will be stored. Widening is the one thing that
        changes what was typed, so it is shown rather than left to be
        discovered in the list afterwards.
      */}
      {preview ? (
        <p className="field__hint">
          Will be saved as <code className="pin-list__pattern">{preview}</code> —{' '}
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

      {/*
        Pins save whether or not the permission is held, so this is a statement
        about what they are currently *doing*, not a gate in front of saving.
        It only appears once there is a pin to be inert, so nobody is asked for
        a permission before they have shown they want the feature.
      */}
      {!granted && patterns.length > 0 ? (
        <div className="notice notice--warning">
          <Icon name="warning" />
          <div className="notice__body">
            <p className="notice__text">
              {sentToFullPage
                ? 'Opened the full page — grant access there, then come back to this popup.'
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

/**
 * Turns the current page into a starting pattern.
 *
 * The path is kept and the query and fragment dropped, so "this page" means the
 * page rather than one particular set of parameters. No wildcard is added here:
 * that is the checkbox's job, and adding one silently is exactly the behaviour
 * this field no longer has.
 */
function suggestFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // `hostname`, not `host`: patterns have no port syntax, so keeping the port
  // here would produce a suggestion that fails to parse on a dev server.
  return normalizeMatchPattern(`${parsed.protocol}//${parsed.hostname}${parsed.pathname}`);
}
