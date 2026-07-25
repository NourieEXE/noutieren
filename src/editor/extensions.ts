import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { sanitizeUrl } from '../utils/url';

/**
 * Editor schema.
 *
 * Tiptap v3's StarterKit already provides bold, italic, underline, strike,
 * headings, both list types, blockquote, inline code, code blocks, links and
 * undo/redo (plus their standard keyboard shortcuts), so only the checklist and
 * the placeholder are added separately.
 *
 * Links are locked down here rather than in the UI alone: autolinked and pasted
 * URLs go through the same allowlist as the link dialog, so `javascript:` can
 * never end up in an href.
 */

export const EDITOR_PLACEHOLDER =
  'Start writing. Markdown shortcuts work too — "# " for a heading, "- " for a list, "> " for a quote.';

export function createEditorExtensions(placeholder = EDITOR_PLACEHOLDER): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        isAllowedUri: (url: string) => sanitizeUrl(url) !== null,
        shouldAutoLink: (url: string) => sanitizeUrl(url) !== null,
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder,
      emptyEditorClass: 'is-editor-empty',
      showOnlyWhenEditable: true,
    }),
  ];
}
