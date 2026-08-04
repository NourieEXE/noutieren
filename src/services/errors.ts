/**
 * Turns thrown values into one short sentence for the UI, while keeping the
 * technical detail available for the console during development.
 */

export class AppError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'AppError';
    this.userMessage = userMessage;
  }
}

const DOM_EXCEPTION_MESSAGES: Record<string, string> = {
  QuotaExceededError: 'Not enough storage space is available. Free up disk space, then try again.',
  NotFoundError: 'The local database could not be found. Try reloading the extension.',
  InvalidStateError: 'The local database is in an unexpected state. Try reloading the extension.',
  VersionError:
    'This database was created by a newer version of Noutieren. Update the extension to open it.',
  AbortError: 'The storage operation was interrupted. Nothing was saved.',
  UnknownError: 'The browser could not complete a storage operation. Your data was not changed.',
  ConstraintError: 'That record already exists.',
  DataCloneError: 'Some note data could not be stored. Please report this note as unusual.',
};

/** Maps any thrown value to a concise, user-appropriate message. */
export function describeError(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;

  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      DOM_EXCEPTION_MESSAGES[error.name] ??
      `A storage error occurred (${error.name}). Your data was not changed.`
    );
  }

  // Dexie wraps failures in named errors that mirror the DOMException names.
  if (error instanceof Error) {
    const mapped = DOM_EXCEPTION_MESSAGES[error.name.replace(/^Dexie/, '')];
    if (mapped) return mapped;
    if (error.name === 'DatabaseClosedError') {
      return 'The local database was closed. Reload the sidebar to continue.';
    }
    if (error.message.trim().length > 0 && error.message.length < 200) return error.message;
  }

  return 'Something went wrong. Your data was not changed.';
}

/**
 * Notes a condition worth knowing about that is not a failure — a browser
 * declining something optional, rather than something going wrong.
 *
 * Logged at `debug`, deliberately, and not at `warn`.
 * `chrome://extensions` collects every `console.warn` and `console.error` into
 * a panel it labels **Errors**, so a line at `warn` level shows up there on
 * every single launch, in every context that boots the app, looking to the user
 * exactly like a fault. The most common such line — Chrome refusing persistent
 * storage, which is that browser's normal answer for an extension origin — is
 * precisely the thing this must not be mistaken for.
 *
 * It stays visible in DevTools (`debug` is shown under Verbose) and nothing is
 * lost from a real diagnosis.
 */
export function logWarning(context: string, message: string): void {
  // eslint-disable-next-line no-console -- see above: `warn` would surface this
  // in Chrome's extension Errors panel, where it does not belong.
  console.debug(`[noutieren] ${context}: ${message}`);
}

/** Logs technical detail without leaking it into the interface. */
export function logError(context: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[noutieren] ${context}`, error);
  } else {
    console.error(`[noutieren] ${context}: ${describeError(error)}`);
  }
}
