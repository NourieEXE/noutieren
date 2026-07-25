import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  extractPlainText,
  isEmptyDocument,
  previewText,
} from '../src/editor/document';
import {
  DocumentTooLargeError,
  MAX_DOCUMENT_NODES,
  looksLikeDocument,
  sanitizeDocument,
} from '../src/editor/sanitize';
import { sanitizeUrl } from '../src/utils/url';

describe('extractPlainText', () => {
  it('joins block nodes with line breaks', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }],
            },
          ],
        },
      ],
    };
    expect(extractPlainText(document)).toBe('Title\nFirst line\nItem');
  });

  it('keeps marked text and converts hard breaks', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'next' },
          ],
        },
      ],
    };
    expect(extractPlainText(document)).toBe('bold\nnext');
  });

  it('handles missing and malformed input', () => {
    expect(extractPlainText(null)).toBe('');
    expect(extractPlainText(undefined)).toBe('');
    expect(extractPlainText({})).toBe('');
    expect(extractPlainText(createEmptyDocument())).toBe('');
  });
});

describe('isEmptyDocument / previewText', () => {
  it('treats a lone empty paragraph as empty', () => {
    expect(isEmptyDocument(createEmptyDocument())).toBe(true);
    expect(isEmptyDocument({ type: 'doc', content: [] })).toBe(true);
    expect(isEmptyDocument(null)).toBe(true);
  });

  it('treats content-bearing documents as non-empty', () => {
    expect(
      isEmptyDocument({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      }),
    ).toBe(false);
    expect(isEmptyDocument({ type: 'doc', content: [{ type: 'horizontalRule' }] })).toBe(false);
  });

  it('collapses whitespace and truncates previews', () => {
    expect(previewText('a\n\n  b   c')).toBe('a b c');
    expect(previewText('x'.repeat(200), 10)).toHaveLength(10);
    expect(previewText('x'.repeat(200), 10).endsWith('…')).toBe(true);
  });
});

describe('sanitizeUrl', () => {
  it('allows http, https and mailto', () => {
    expect(sanitizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(sanitizeUrl('http://example.com/')).toBe('http://example.com/');
    expect(sanitizeUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('adds https to bare domains', () => {
    expect(sanitizeUrl('example.com/page')).toBe('https://example.com/page');
  });

  it('rejects dangerous and unusable schemes', () => {
    for (const value of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'data:text/html,<script>x</script>',
      'file:///etc/passwd',
      'moz-extension://abc/page.html',
      'vbscript:msgbox(1)',
      '',
      '   ',
      null,
      undefined,
      12,
    ]) {
      expect(sanitizeUrl(value), String(value)).toBeNull();
    }
  });
});

describe('sanitizeDocument', () => {
  it('keeps supported nodes and marks', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Head' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }, { type: 'italic' }] }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }],
            },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'x' }] },
      ],
    };
    const result = sanitizeDocument(input);
    expect(result).toEqual(input);
  });

  it('drops unknown node and mark types', () => {
    const result = sanitizeDocument({
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'nope' }] },
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'kept', marks: [{ type: 'bold' }, { type: 'evilMark' }] },
          ],
        },
      ],
    });

    expect(JSON.stringify(result)).not.toContain('script');
    expect(JSON.stringify(result)).not.toContain('iframe');
    expect(JSON.stringify(result)).not.toContain('evilMark');
    expect(extractPlainText(result)).toBe('kept');
  });

  it('strips unknown attributes, including event handlers', () => {
    const result = sanitizeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)', style: 'position:fixed', class: 'x' },
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('onclick');
    expect(JSON.stringify(result)).not.toContain('position:fixed');
  });

  it('removes link marks whose href is not a safe URL', () => {
    const result = sanitizeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('javascript');
    // The text survives; only the dangerous anchor is dropped.
    expect(extractPlainText(result)).toBe('click');
  });

  it('normalizes safe links and forces safe anchor attributes', () => {
    const result = sanitizeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'example.com', target: '_self', rel: 'me' } }],
            },
          ],
        },
      ],
    });
    const mark = (result.content?.[0]?.content?.[0]?.marks ?? [])[0];
    expect(mark?.attrs).toEqual({
      href: 'https://example.com/',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });

  it('clamps heading levels to the supported range', () => {
    const result = sanitizeDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'a' }] },
        { type: 'heading', attrs: { level: 0 }, content: [{ type: 'text', text: 'b' }] },
      ],
    });
    expect(result.content?.[0]?.attrs?.level).toBe(3);
    expect(result.content?.[1]?.attrs?.level).toBe(1);
  });

  it('returns an empty document for unusable input', () => {
    expect(sanitizeDocument(null)).toEqual(createEmptyDocument());
    expect(sanitizeDocument('a string')).toEqual(createEmptyDocument());
    expect(sanitizeDocument({ type: 'paragraph' })).toEqual(createEmptyDocument());
  });

  it('rejects implausibly large documents instead of truncating', () => {
    const content = Array.from({ length: MAX_DOCUMENT_NODES + 10 }, () => ({
      type: 'paragraph',
    }));
    expect(() => sanitizeDocument({ type: 'doc', content })).toThrow(DocumentTooLargeError);
  });
});

describe('looksLikeDocument', () => {
  it('recognises documents and rejects other shapes', () => {
    expect(looksLikeDocument({ type: 'doc', content: [] })).toBe(true);
    expect(looksLikeDocument({ type: 'doc' })).toBe(true);
    expect(looksLikeDocument({ type: 'paragraph' })).toBe(false);
    expect(looksLikeDocument([])).toBe(false);
    expect(looksLikeDocument('doc')).toBe(false);
    expect(looksLikeDocument({ type: 'doc', content: 'no' })).toBe(false);
  });
});
