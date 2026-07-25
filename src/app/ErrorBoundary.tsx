import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../services/errors';

interface State {
  error: Error | null;
}

/**
 * Catches render-time failures so a bug in one panel cannot leave the user
 * staring at a blank sidebar. Stored notes are untouched by a render error, so
 * the message says so explicitly and offers a reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logError(`render (${info.componentStack?.split('\n')[1]?.trim() ?? 'unknown'})`, error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="fatal">
        <h1 className="fatal__title">Something went wrong</h1>
        <p>
          Noutieren could not display your notes. Your saved notes are still on this device — this
          is a problem with the interface, not with your data.
        </p>
        <div className="fatal__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button type="button" className="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
        <details className="details">
          <summary>Technical details</summary>
          <pre className="fatal__detail">{`${error.name}: ${error.message}`}</pre>
        </details>
      </div>
    );
  }
}
