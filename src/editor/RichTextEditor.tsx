import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '../types';
import { createEditorExtensions } from './extensions';
import { extractPlainText } from './document';
import { EditorToolbar } from './EditorToolbar';

/**
 * Tiptap/ProseMirror editor for a single note.
 *
 * **This component must be mounted with `key={noteId}`.** A fresh instance per
 * note is what guarantees that switching notes cannot carry a document, an
 * undo history, or a pending update from one note into another: the outgoing
 * instance flushes its own note on unmount, and the incoming one is created
 * with its own content.
 *
 * Callbacks are held in refs so the editor is created exactly once per mount —
 * a re-created editor would lose the cursor and the undo stack.
 */
export function RichTextEditor({
  noteId,
  initialContent,
  ariaLabel,
  onChange,
  onFlush,
}: {
  noteId: string;
  initialContent: JSONContent;
  ariaLabel: string;
  onChange: (noteId: string, content: JSONContent, plainText: string) => void;
  onFlush: (noteId: string) => void;
}) {
  const noteIdRef = useRef(noteId);
  const onChangeRef = useRef(onChange);
  const onFlushRef = useRef(onFlush);

  // Keep the latest callbacks reachable from the editor's own handlers without
  // re-creating the editor (which would drop the cursor and undo history).
  useEffect(() => {
    noteIdRef.current = noteId;
    onChangeRef.current = onChange;
    onFlushRef.current = onFlush;
  });

  const extensions = useMemo(() => createEditorExtensions(), []);

  const editor = useEditor(
    {
      extensions,
      content: initialContent,
      // Tiptap otherwise injects its base stylesheet at runtime by assigning to
      // `innerHTML`. The equivalent rules are in the static stylesheet instead,
      // so the extension never writes markup into the document at runtime.
      injectCSS: false,
      editorProps: {
        attributes: {
          class: 'editor__surface',
          // The contenteditable region keeps its native semantics; only a name
          // is added so it is identifiable to assistive technology.
          'aria-label': ariaLabel,
        },
      },
      onUpdate: ({ editor: instance }) => {
        const content = instance.getJSON();
        onChangeRef.current(noteIdRef.current, content, extractPlainText(content));
      },
      onBlur: () => {
        onFlushRef.current(noteIdRef.current);
      },
    },
    [],
  );

  // Write pending edits when this note's editor goes away.
  useEffect(
    () => () => {
      onFlushRef.current(noteIdRef.current);
    },
    [],
  );

  return (
    <div className="editor">
      <EditorToolbar editor={editor} />
      <EditorContent className="editor__content" editor={editor} />
    </div>
  );
}
