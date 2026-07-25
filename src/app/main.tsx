import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/global.css';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastProvider } from '../components/ToastProvider';
import { AppBootstrap } from './AppBootstrap';
import { detectViewMode } from '../services/webext';

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
