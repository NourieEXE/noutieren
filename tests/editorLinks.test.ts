import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorExtensions } from '../src/editor/extensions';

/**
 * The live editor, not just the import sanitizer, refuses links that could run
 * code in the extension's pages. Pasted HTML takes this path.
 */

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function linkAfterPasting(html: string): unknown {
  editor = new Editor({ extensions: createEditorExtensions(), injectCSS: false });
  editor.commands.setContent(html);
  return editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href ?? null;
}

describe('links in the editor', () => {
  it.each([
    ['javascript:alert(1)'],
    [' JaVaScRiPt:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
  ])('drops %s from pasted HTML', (href) => {
    expect(linkAfterPasting(`<p><a href="${href}">link</a></p>`)).toBeNull();
    expect(editor!.getHTML()).toBe('<p>link</p>');
  });

  it('keeps an ordinary link, opening without a referrer', () => {
    expect(linkAfterPasting('<p><a href="https://example.com/">link</a></p>')).toBe(
      'https://example.com/',
    );
    expect(editor!.getHTML()).toContain('rel="noopener noreferrer nofollow"');
  });

  it('refuses to set a script link through the link command', () => {
    editor = new Editor({ extensions: createEditorExtensions(), injectCSS: false });
    editor.commands.setContent('<p>text</p>');
    editor.commands.selectAll();

    expect(editor.commands.setLink({ href: 'javascript:alert(1)' })).toBe(false);
    expect(editor.getHTML()).toBe('<p>text</p>');
  });
});
