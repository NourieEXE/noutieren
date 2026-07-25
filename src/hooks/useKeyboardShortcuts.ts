import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  onNewNote: () => void;
  onNewTab: () => void;
  onFocusSearch: () => void;
  onFlushSaves: () => void;
}

/**
 * Application shortcuts.
 *
 * Only Ctrl/Cmd combinations that are not text-editing commands are claimed, so
 * everything the editor binds (Ctrl+B, Ctrl+I, Ctrl+Z, …) keeps working while
 * the document has focus. Escape is handled by the dialogs and menus
 * themselves.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);

  // The window listener is attached once; this keeps it calling the current
  // handlers rather than the ones from the first render.
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case 'n':
          event.preventDefault();
          if (event.shiftKey) ref.current.onNewTab();
          else ref.current.onNewNote();
          break;
        case 'k':
          if (event.shiftKey) return;
          event.preventDefault();
          ref.current.onFocusSearch();
          break;
        case 's':
          if (event.shiftKey) return;
          event.preventDefault();
          ref.current.onFlushSaves();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
