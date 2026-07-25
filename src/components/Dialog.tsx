import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icons';

/**
 * Modal dialog built on the native `<dialog>` element.
 *
 * `showModal()` gives correct behaviour for free and without a hand-rolled
 * trap: focus is confined to the dialog, Escape closes it, focus returns to the
 * element that opened it, and the rest of the page is inert.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'normal',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'normal' | 'wide';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (open && !element.open) {
      // jsdom did not always implement showModal; fall back so tests can run.
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    } else if (!open && element.open) {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${width}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Keep React in charge of `open` rather than letting the browser close
        // the element behind our back.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__inner">
        <header className="dialog__header">
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </header>
        {description ? (
          <p className="dialog__description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        {children ? <div className="dialog__body">{children}</div> : null}
        {footer ? <footer className="dialog__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

/**
 * Confirmation for destructive actions.
 *
 * The confirm button is never the default focus target, so a stray Enter or
 * double click cannot delete anything.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'normal';
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <button type="button" className="button" onClick={onClose} ref={cancelRef}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'button button--danger' : 'button button--primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
