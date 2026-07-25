import type { JSONContent } from '@tiptap/core';

/** An empty ProseMirror document with a single paragraph. */
export function createEmptyDocument(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Block-level nodes whose end introduces a line break in the plain text. */
const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
]);

/**
 * Renders a document to plain text for search and list previews.
 *
 * Kept separate from the editor instance so it can run without a live
 * ProseMirror view (during import, in tests, and in the autosave path).
 */
export function extractPlainText(document: JSONContent | null | undefined): string {
  if (!document || typeof document !== 'object') return '';

  const parts: string[] = [];

  const walk = (node: JSONContent): void => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'text') {
      if (typeof node.text === 'string') parts.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
    if (typeof node.type === 'string' && BLOCK_NODES.has(node.type)) {
      parts.push('\n');
    }
  };

  walk(document);

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when a document holds no text and no meaningful nodes. */
export function isEmptyDocument(document: JSONContent | null | undefined): boolean {
  if (!document) return true;
  if (extractPlainText(document).length > 0) return false;
  // A lone empty paragraph is "empty"; a horizontal rule or checklist is not.
  const content = Array.isArray(document.content) ? document.content : [];
  return content.every((node) => node.type === 'paragraph' && !node.content?.length);
}

/** Single-line preview text for the notes list. */
export function previewText(plainText: string, maxLength = 140): string {
  const collapsed = plainText.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}
