import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Small dropdown menu.
 *
 * Keyboard behaviour follows the usual menu-button pattern: Enter/Space or
 * ArrowDown opens and focuses the first item, arrows move, Escape closes and
 * returns focus to the trigger, and a click elsewhere dismisses it.
 */
export function Menu({
  label,
  trigger,
  children,
  align = 'end',
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const wasOpen = useRef(false);

  // `close` only changes state, so it is safe to hand to the render prop.
  const close = useCallback(() => setOpen(false), []);

  /*
   * Return focus to the trigger when the menu closes — but only if focus was
   * still inside the menu (Escape, or choosing an item). Closing by clicking
   * elsewhere must leave focus where the user put it.
   */
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;

    const active = document.activeElement;
    const focusWasInMenu = active instanceof Node && containerRef.current?.contains(active);
    if (focusWasInMenu || active === document.body || active === null) {
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const container = containerRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (!container?.contains(event.target as Node)) setOpen(false);
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !container?.contains(next)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    container?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      container?.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

  const focusItem = useCallback((offset: number) => {
    const items = containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const list = [...items].filter((item) => !item.hasAttribute('disabled'));
    const active = document.activeElement as HTMLElement | null;
    const index = active ? list.indexOf(active) : -1;
    const next =
      index === -1
        ? offset > 0
          ? 0
          : list.length - 1
        : (index + offset + list.length) % list.length;
    list[next]?.focus();
  }, []);

  return (
    <div className={`menu menu--${align}`} ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => focusItem(event.key === 'ArrowDown' ? 1 : -1));
          }
        }}
      >
        {trigger}
      </button>

      {open ? (
        <div
          className="menu__list"
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusItem(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              focusItem(-1);
            } else if (event.key === 'Tab') {
              setOpen(false);
            }
          }}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  tone = 'normal',
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'normal' | 'danger';
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu__item${tone === 'danger' ? ' menu__item--danger' : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

export function MenuSeparator({ label }: { label?: string }) {
  if (label) {
    return (
      <div className="menu__group-label" role="presentation">
        {label}
      </div>
    );
  }
  return <div className="menu__separator" role="separator" />;
}
