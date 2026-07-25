import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext, type Toast, type ToastApi } from '../hooks/toastContext';
import { createId } from '../utils/id';

const DEFAULT_DURATION = 6000;

/**
 * Transient status messages, including the undo affordance for note deletion.
 *
 * Informational messages go to a polite live region; errors go to an assertive
 * one so a screen reader announces failures immediately.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<ToastApi['push']>((input) => {
    const id = createId();
    const toast: Toast = {
      id,
      message: input.message,
      tone: input.tone ?? 'info',
      duration: input.duration ?? DEFAULT_DURATION,
      ...(input.action ? { action: input.action } : {}),
    };
    setToasts((current) => [...current, toast]);
    if (toast.duration > 0) {
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setToasts((current) => current.filter((item) => item.id !== id));
        }, toast.duration),
      );
    }
    return id;
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  const polite = toasts.filter((toast) => toast.tone !== 'error');
  const assertive = toasts.filter((toast) => toast.tone === 'error');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-layer">
        <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
          {polite.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
        <div className="toast-region" role="alert" aria-live="assertive" aria-atomic="false">
          {assertive.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  return (
    <div className={`toast toast--${toast.tone}`}>
      <span className="toast__message">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="button button--ghost toast__action"
          onClick={() => {
            toast.action?.onAction();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="icon-button icon-button--small toast__close"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss: ${toast.message}`}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
