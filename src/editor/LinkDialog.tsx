import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { sanitizeUrl } from '../utils/url';

/**
 * Insert or edit a link.
 *
 * The typed value is normalized and protocol-checked before it reaches the
 * document, so only http, https and mailto links can be created.
 *
 * The form is a child that exists only while the dialog is open, so its value
 * starts from the current link without an effect syncing props into state.
 */
export function LinkDialog({
  open,
  initialHref,
  onClose,
  onSubmit,
  onRemove,
}: {
  open: boolean;
  initialHref: string;
  onClose: () => void;
  onSubmit: (href: string) => void;
  onRemove: () => void;
}) {
  const submitRef = useRef<() => void>(() => undefined);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initialHref ? 'Edit link' : 'Add link'}
      footer={
        <>
          {initialHref ? (
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Remove link
            </button>
          ) : null}
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => submitRef.current()}
          >
            {initialHref ? 'Update' : 'Add link'}
          </button>
        </>
      }
    >
      {open ? (
        <LinkField
          key={initialHref}
          initialHref={initialHref}
          onSubmit={onSubmit}
          onClose={onClose}
          registerSubmit={(submit) => {
            submitRef.current = submit;
          }}
        />
      ) : null}
    </Dialog>
  );
}

function LinkField({
  initialHref,
  onSubmit,
  onClose,
  registerSubmit,
}: {
  initialHref: string;
  onSubmit: (href: string) => void;
  onClose: () => void;
  registerSubmit: (submit: () => void) => void;
}) {
  const [value, setValue] = useState(initialHref);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    // Select the existing address so it can be replaced by typing.
    const timer = setTimeout(() => inputRef.current?.select(), 0);
    return () => clearTimeout(timer);
  }, []);

  const submit = () => {
    const href = sanitizeUrl(value);
    if (!href) {
      setError('Enter a web address starting with http://, https:// or mailto:');
      inputRef.current?.focus();
      return;
    }
    onSubmit(href);
    onClose();
  };

  // Registered after commit rather than during render, so the parent's footer
  // button always calls the current closure.
  useEffect(() => {
    registerSubmit(submit);
  });

  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        Web address
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="input"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="example.com/page"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      />
      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
