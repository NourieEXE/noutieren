import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/global.css';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastProvider } from '../components/ToastProvider';
import { AppBootstrap } from './AppBootstrap';
import { detectViewMode } from '../services/webext';

/**
 * Renders the application into `#root`.
 *
 * A function rather than module-level side effects, because each target has its
 * own entry point — Firefox's `main.tsx`, Chrome's `entry.tsx` — and Chrome's
 * has setup of its own to do first. Import order deciding whether notes save
 * reliably would be a trap; an explicit call cannot be reordered by accident.
 */
export function mount(): void {
  // Exposed for CSS that needs to know the surface (the layout itself is
  // width-driven, not surface-driven).
  document.documentElement.dataset.view = detectViewMode();

  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root element.');

  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <ToastProvider>
          <AppBootstrap />
        </ToastProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
