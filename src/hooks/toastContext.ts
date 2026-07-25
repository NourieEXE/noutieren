import { createContext, useContext } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  /** Auto-dismiss delay in ms; `0` keeps the toast until dismissed. */
  duration: number;
}

export type ToastInput = { message: string; action?: ToastAction } & Partial<
  Pick<Toast, 'tone' | 'duration'>
>;

export interface ToastApi {
  toasts: readonly Toast[];
  /** Shows a toast and returns its id. */
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToasts(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToasts must be used inside <ToastProvider>.');
  return context;
}
