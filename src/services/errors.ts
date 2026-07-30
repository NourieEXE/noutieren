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
 */
export function logWarning(context: string, message: string): void {
  console.warn(`[noutieren] ${context}: ${message}`);
}

/** Logs technical detail without leaking it into the interface. */
export function logError(context: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[noutieren] ${context}`, error);
  } else {
    console.error(`[noutieren] ${context}: ${describeError(error)}`);
  }
}
