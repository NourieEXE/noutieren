import type { JSONContent } from '@tiptap/core';
import { sanitizeUrl } from '../utils/url';
import { createEmptyDocument } from './document';

/**
 * Rebuilds an untrusted ProseMirror document from an allowlist.
 *
 * Imported backups are data, not code: this drops every node type, mark and
 * attribute the editor does not define, so nothing from a file can turn into
 * executable markup or an unexpected schema node. It always returns a document
 * the editor can render.
 */

/** Node types the editor supports, mapped to the attributes each may keep. */
const ALLOWED_NODES: Record<string, readonly string[]> = {
  doc: [],
  paragraph: [],
  text: [],
  heading: ['level'],
  bulletList: [],
  orderedList: ['start'],
  listItem: [],
  taskList: [],
  taskItem: ['checked'],
  blockquote: [],
  codeBlock: ['language'],
  hardBreak: [],
  horizontalRule: [],
};

/** Mark types the editor supports, mapped to the attributes each may keep. */
const ALLOWED_MARKS: Record<string, readonly string[]> = {
  bold: [],
  italic: [],
  underline: [],
  strike: [],
  code: [],
  link: ['href', 'target', 'rel'],
};

/** Guards against pathological files; far above any realistic note. */
export const MAX_DOCUMENT_NODES = 100_000;

export class DocumentTooLargeError extends Error {
  constructor() {
    super(`Document exceeds the maximum of ${MAX_DOCUMENT_NODES} nodes.`);
    this.name = 'DocumentTooLargeError';
  }
}

function sanitizeMarks(marks: unknown): JSONContent['marks'] {
  if (!Array.isArray(marks)) return undefined;

  const result: NonNullable<JSONContent['marks']> = [];
  for (const mark of marks) {
    if (!mark || typeof mark !== 'object') continue;
    const type = (mark as { type?: unknown }).type;
    if (typeof type !== 'string') continue;
    const allowedAttrs = ALLOWED_MARKS[type];
    if (!allowedAttrs) continue;

    if (type === 'link') {
      const rawAttrs = (mark as { attrs?: Record<string, unknown> }).attrs ?? {};
      const href = sanitizeUrl(rawAttrs.href);
      // A link without a usable target becomes plain text rather than an
      // anchor pointing somewhere unexpected.
      if (!href) continue;
      result.push({ type, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });
      continue;
    }

    result.push({ type });
  }
  return result.length > 0 ? result : undefined;
}

function sanitizeAttrs(type: string, attrs: unknown): Record<string, unknown> | undefined {
  const allowed = ALLOWED_NODES[type];
  if (!allowed || allowed.length === 0) return undefined;
  if (!attrs || typeof attrs !== 'object') return undefined;

  const source = attrs as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of allowed) {
    const value = source[key];
    if (value === undefined || value === null) continue;

    if (type === 'heading' && key === 'level') {
      const level = typeof value === 'number' ? Math.round(value) : Number.NaN;
      // The toolbar only offers H1–H3; clamp anything else into range.
      result.level = Number.isFinite(level) ? Math.min(3, Math.max(1, level)) : 1;
      continue;
    }
    if (type === 'taskItem' && key === 'checked') {
      result.checked = value === true;
      continue;
    }
    if (type === 'orderedList' && key === 'start') {
      const start = typeof value === 'number' ? Math.round(value) : Number.NaN;
      if (Number.isFinite(start) && start >= 0) result.start = start;
      continue;
    }
    if (type === 'codeBlock' && key === 'language') {
      // Only a conservative identifier; it is rendered into a class name.
      if (typeof value === 'string' && /^[\w+#.-]{1,32}$/.test(value)) result.language = value;
      continue;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Returns an allowlisted copy of `input`.
 *
 * @throws {DocumentTooLargeError} when the document has an implausible number
 * of nodes, which is rejected rather than silently truncated.
 */
export function sanitizeDocument(input: unknown): JSONContent {
  let nodeCount = 0;

  const sanitizeNode = (node: unknown): JSONContent | null => {
    if (!node || typeof node !== 'object') return null;
    const source = node as JSONContent;
    const type = typeof source.type === 'string' ? source.type : null;
    if (!type || !(type in ALLOWED_NODES)) return null;

    nodeCount += 1;
    if (nodeCount > MAX_DOCUMENT_NODES) throw new DocumentTooLargeError();

    const result: JSONContent = { type };

    if (type === 'text') {
      if (typeof source.text !== 'string' || source.text.length === 0) return null;
      result.text = source.text;
      const marks = sanitizeMarks(source.marks);
      if (marks) result.marks = marks;
      return result;
    }

    const attrs = sanitizeAttrs(type, source.attrs);
    if (attrs) result.attrs = attrs;

    if (Array.isArray(source.content)) {
      const children: JSONContent[] = [];
      for (const child of source.content) {
        const sanitized = sanitizeNode(child);
        if (sanitized) children.push(sanitized);
      }
      if (children.length > 0) result.content = children;
    }

    return result;
  };

  const sanitized = sanitizeNode(input);
  if (!sanitized || sanitized.type !== 'doc' || !sanitized.content?.length) {
    // Anything unrecognisable becomes an empty document instead of an error:
    // losing formatting is recoverable, losing the whole import is not.
    const salvaged = sanitized?.content?.length ? sanitized.content : null;
    return salvaged ? { type: 'doc', content: salvaged } : createEmptyDocument();
  }
  return sanitized;
}

/** Shallow structural check used by import validation before sanitizing. */
export function looksLikeDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as JSONContent;
  if (candidate.type !== 'doc') return false;
  return candidate.content === undefined || Array.isArray(candidate.content);
}
