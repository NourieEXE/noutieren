/**
 * URL match patterns for "Pin to URL".
 *
 * Syntax is the WebExtension match pattern: `<scheme>://<host><path>`.
 * Pure string matching, no browser access.
 *
 * A wildcard is never added for the user. `https://example.com/` pins the root
 * only; `https://example.com/*` covers the site. The two gaps that get filled
 * are unambiguous: a missing scheme becomes `*://`, and a missing path becomes
 * `/`. Widening is `widenToPrefix`, called from the editor.
 *
 * Scheme and host compare case-insensitively, the path case-sensitively, and
 * the fragment is never matched.
 */

const CONCRETE_SCHEMES = ['http', 'https'] as const;

type ConcreteScheme = (typeof CONCRETE_SCHEMES)[number];

export interface MatchPattern {
  /** Normalized text, which is what gets stored. */
  readonly source: string;
  /** `null` for `*`, meaning http and https both. */
  readonly scheme: ConcreteScheme | null;
  /** `null` for `*`, meaning any host. Lowercased, no leading `*.`. */
  readonly host: string | null;
  /** True for `*.example.com`, which also matches `example.com`. */
  readonly matchSubdomains: boolean;
  /** Tested against pathname + search. */
  readonly path: RegExp;
}

export const ALL_URLS = '<all_urls>';

export const MAX_PATTERNS_PER_PIN = 20;

const MAX_PATTERN_LENGTH = 2048;

/** Each `*` becomes `.*`, and a long chain backtracks badly. */
const MAX_PATH_WILDCARDS = 10;

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export type PatternParseResult =
  { ok: true; pattern: MatchPattern } | { ok: false; reason: string };

export function parseMatchPattern(input: unknown): MatchPattern | null {
  const result = parsePattern(input);
  return result.ok ? result.pattern : null;
}

/** Parses a pattern, naming the offending part when it fails. */
export function parsePattern(input: unknown): PatternParseResult {
  if (typeof input !== 'string') return { ok: false, reason: 'Enter a URL pattern.' };

  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'Enter a URL pattern.' };
  if (trimmed.length > MAX_PATTERN_LENGTH)
    return { ok: false, reason: 'That pattern is too long.' };

  if (trimmed === ALL_URLS) {
    return {
      ok: true,
      pattern: {
        source: ALL_URLS,
        scheme: null,
        host: null,
        matchSubdomains: true,
        path: /^.*$/,
      },
    };
  }

  // Tested on `://` rather than on a scheme, so `http:/example.com` stays an
  // error instead of being read as a hostname.
  const withScheme = trimmed.includes('://') ? trimmed : `*://${trimmed}`;

  const separator = withScheme.indexOf('://');
  const rawScheme = withScheme.slice(0, separator).toLowerCase();
  const remainder = withScheme.slice(separator + 3);

  let scheme: ConcreteScheme | null;
  if (rawScheme === '*') {
    scheme = null;
  } else if ((CONCRETE_SCHEMES as readonly string[]).includes(rawScheme)) {
    scheme = rawScheme as ConcreteScheme;
  } else {
    return { ok: false, reason: `Only http and https can be pinned, not "${rawScheme}".` };
  }

  if (remainder.length === 0) return { ok: false, reason: 'Add a host, such as example.com.' };

  const slash = remainder.indexOf('/');
  const rawHost = (slash === -1 ? remainder : remainder.slice(0, slash)).toLowerCase();
  const rawPath = slash === -1 ? '/' : remainder.slice(slash);

  const host = parseHost(rawHost);
  if (!host.ok) return { ok: false, reason: host.reason };

  if (rawPath.includes('#')) {
    return { ok: false, reason: 'Patterns cannot include a #fragment. It is never matched.' };
  }
  if (countWildcards(rawPath) > MAX_PATH_WILDCARDS) {
    return { ok: false, reason: 'That pattern uses too many "*" wildcards.' };
  }

  return {
    ok: true,
    pattern: {
      source: `${rawScheme}://${rawHost}${rawPath}`,
      scheme,
      host: host.host,
      matchSubdomains: host.matchSubdomains,
      path: compilePath(rawPath),
    },
  };
}

type HostParseResult =
  { ok: true; host: string | null; matchSubdomains: boolean } | { ok: false; reason: string };

function parseHost(rawHost: string): HostParseResult {
  if (rawHost === '*') return { ok: true, host: null, matchSubdomains: true };

  const matchSubdomains = rawHost.startsWith('*.');
  const base = matchSubdomains ? rawHost.slice(2) : rawHost;

  if (base.length === 0) {
    return {
      ok: false,
      reason: matchSubdomains ? 'Add a domain after "*.".' : 'Add a host, such as example.com.',
    };
  }
  if (base.includes('*')) {
    return { ok: false, reason: '"*" is only allowed as the whole host or as a leading "*.".' };
  }
  // Checked before the shape test so the message names the real problem.
  if (/:\d+$/.test(base)) {
    return { ok: false, reason: 'Patterns cannot include a port number.' };
  }
  if (!HOST_PATTERN.test(base)) {
    return { ok: false, reason: `"${base}" is not a valid host name.` };
  }

  return { ok: true, host: base, matchSubdomains };
}

function countWildcards(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === '*') count += 1;
  }
  return count;
}

/**
 * Split on the wildcard first, then escape each literal run, so `/watch?v=abc`
 * matches literally instead of `?` making the `h` optional.
 */
function compilePath(rawPath: string): RegExp {
  const escaped = rawPath
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

/** The stored form of a valid pattern, or `null`. */
export function normalizeMatchPattern(input: unknown): string | null {
  return parseMatchPattern(input)?.source ?? null;
}

/**
 * Widens a pattern to cover everything under its path. Idempotent, so ticking
 * the option twice cannot produce `/**`.
 */
export function widenToPrefix(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.endsWith('*')) return trimmed;

  // `/*` when there is no path yet, since a bare `*` would give
  // `example.com*`, which also covers `example.community`.
  const separator = trimmed.indexOf('://');
  const afterHost = separator === -1 ? trimmed : trimmed.slice(separator + 3);
  return afterHost.includes('/') ? `${trimmed}*` : `${trimmed}/*`;
}

/** Whether a pattern covers more than one exact address. */
export function isWildcardPattern(source: string): boolean {
  const pattern = parseMatchPattern(source);
  if (!pattern) return false;
  const path = pattern.source.slice(pattern.source.indexOf('://') + 3).replace(/^[^/]*/, '');
  return path.includes('*');
}

export function matchesPattern(pattern: MatchPattern, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only http(s) is pinnable, so `about:` and `moz-extension:` never match.
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (!(CONCRETE_SCHEMES as readonly string[]).includes(scheme)) return false;
  if (pattern.scheme !== null && pattern.scheme !== scheme) return false;

  if (pattern.host !== null) {
    const host = parsed.hostname.toLowerCase();
    if (pattern.matchSubdomains) {
      // Dotted suffix, so `*.example.com` cannot match `notexample.com`.
      if (host !== pattern.host && !host.endsWith(`.${pattern.host}`)) return false;
    } else if (host !== pattern.host) {
      return false;
    }
  }

  // `search` carries its own `?`, so this is the URL after the host with the
  // fragment dropped.
  return pattern.path.test(`${parsed.pathname}${parsed.search}`);
}

/**
 * Whether a URL satisfies any pattern in a pin. An empty list means "not
 * pinned", so callers treat an unpinned item as visible without coming here.
 */
export function matchesAnyPattern(patterns: readonly string[], url: string | null): boolean {
  if (!url || patterns.length === 0) return false;
  return patterns.some((source) => {
    const pattern = parseMatchPattern(source);
    return pattern !== null && matchesPattern(pattern, url);
  });
}

/**
 * Cleans a stored or imported list. Invalid entries are dropped rather than
 * rejected, so a hand-edited backup still imports the pins it got right.
 */
export function sanitizePatternList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeMatchPattern(entry);
    if (normalized) seen.add(normalized);
    if (seen.size >= MAX_PATTERNS_PER_PIN) break;
  }
  return [...seen];
}

/** A short description of what a pattern covers, for the pin list. */
export function describePattern(source: string): string {
  const pattern = parseMatchPattern(source);
  if (!pattern) return 'Invalid pattern';
  if (pattern.host === null) return 'Any website';

  const host = pattern.matchSubdomains ? `${pattern.host} and its subdomains` : pattern.host;
  const rawPath = pattern.source.slice(pattern.source.indexOf('://') + 3).replace(/^[^/]*/, '');

  if (rawPath === '/*') return host;
  if (rawPath === '/') return `${host}, home page only`;
  if (rawPath.endsWith('*')) return `${host}${rawPath.slice(0, -1)}…`;
  return `${host}${rawPath}, exactly`;
}
