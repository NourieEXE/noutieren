/**
 * URL match patterns, used by "Pin to URL" to decide whether a tab or a note is
 * visible for the page currently in the browser.
 *
 * The syntax is the WebExtension match pattern:
 *
 *     <scheme>://<host><path>
 *
 * It is reused rather than invented because it is documented, widely known, and
 * already answers the awkward questions — what `*.example.com` does about the
 * apex domain, whether a trailing slash means "the root only". Nothing here
 * talks to the browser: this module is a pure string matcher, which is what
 * makes the behaviour testable without a tab open.
 *
 * **A wildcard is never added on your behalf.** What you type is what is
 * stored: `https://example.com/` pins the home page and nothing else, and only
 * `https://example.com/*` covers the whole site. An earlier version quietly
 * completed a missing path to `/*`, which meant a pattern could come back
 * broader than the one that was entered — the editor now offers an explicit
 * "everything under this address" option instead, so widening is always a
 * choice someone made.
 *
 * The two things still filled in are unambiguous, because there is only one
 * thing they could mean:
 *
 * - A missing scheme: `example.com` is read as `*://example.com/`.
 * - A missing path: `https://example.com` is read as `https://example.com/`,
 *   which is what a browser does with the same text.
 *
 * Matching follows the specification: scheme and host are compared
 * case-insensitively, the path case-sensitively, and the fragment is never
 * considered.
 */

/** Schemes a pin may target. `*` means http or https, as in the specification. */
const CONCRETE_SCHEMES = ['http', 'https'] as const;

type ConcreteScheme = (typeof CONCRETE_SCHEMES)[number];

export interface MatchPattern {
  /** The normalized source text, which is what gets stored. */
  readonly source: string;
  /** `null` for `*`, meaning http and https both. */
  readonly scheme: ConcreteScheme | null;
  /** `null` for `*`, meaning any host. Lowercased, no leading `*.`. */
  readonly host: string | null;
  /** True for `*.example.com`, which also matches `example.com` itself. */
  readonly matchSubdomains: boolean;
  /** Compiled from the path glob; tested against pathname + search. */
  readonly path: RegExp;
}

/** Matches every http(s) URL. Accepted as a convenience, as in the manifest. */
export const ALL_URLS = '<all_urls>';

/** A pin's pattern list is capped so one tab cannot carry unbounded storage. */
export const MAX_PATTERNS_PER_PIN = 20;

const MAX_PATTERN_LENGTH = 2048;

/**
 * Wildcards allowed in one path.
 *
 * Each `*` becomes `.*`, and a chain of them backtracks super-linearly against a
 * long non-matching URL. Ten is far past any real pin and keeps the worst case
 * uninteresting.
 */
const MAX_PATH_WILDCARDS = 10;

/**
 * Parses a match pattern, returning `null` if it cannot be understood.
 *
 * Callers that need to explain the failure to a user should use `parsePattern`
 * instead, which reports the same decision with a reason.
 */
export function parseMatchPattern(input: unknown): MatchPattern | null {
  const result = parsePattern(input);
  return result.ok ? result.pattern : null;
}

export type PatternParseResult =
  { ok: true; pattern: MatchPattern } | { ok: false; reason: string };

/**
 * Parses a pattern, explaining any rejection in terms a user can act on.
 *
 * The messages name the offending part rather than restating the grammar: the
 * field this feeds shows one line under an input, not documentation.
 */
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

  // A bare host is completed to `*://host/*`. Detected by the absence of `://`
  // rather than by a scheme test, so `http:/example.com` is still an error
  // instead of being silently treated as a hostname.
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

  // The host ends at the first slash; everything from there on is the path. A
  // pattern with no slash at all is completed to `/` — the root, exactly as a
  // browser would read it — and deliberately *not* to `/*`, which would widen
  // the pin beyond what was typed.
  const slash = remainder.indexOf('/');
  const rawHost = (slash === -1 ? remainder : remainder.slice(0, slash)).toLowerCase();
  const rawPath = slash === -1 ? '/' : remainder.slice(slash);

  const host = parseHost(rawHost);
  if (!host.ok) return { ok: false, reason: host.reason };

  if (rawPath.includes('#')) {
    return { ok: false, reason: 'Patterns cannot include a #fragment — it is never matched.' };
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

/**
 * What may appear in a host once the optional leading `*.` is removed.
 *
 * Without this, anything that merely lacks a `/` is taken for a hostname, and
 * an input such as `javascript:alert(1)` parses "successfully" into a pattern
 * that can never match. Rejecting it outright is what lets the pin editor tell
 * the user their input was wrong instead of silently storing a dead rule.
 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

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

  // Checked before the shape test so the message names the real problem: a port
  // is a plausible thing to type, and "not a valid host name" would not explain
  // it. Match patterns have no port syntax, and the port is never matched.
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
 * Compiles the path glob.
 *
 * Split on the wildcard first, then escape each literal run. Escaping first and
 * substituting afterwards would need a placeholder character, and every
 * candidate placeholder is one a path is allowed to contain. `*` is the only
 * metacharacter: a pattern such as `/watch?v=abc` must match literally, not as a
 * regular expression where `?` would quietly make the `h` optional.
 */
function compilePath(rawPath: string): RegExp {
  const escaped = rawPath
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Returns the normalized text of a valid pattern, or `null`.
 *
 * This is the form written to storage, so the completed pattern and the one the
 * user sees in the pin list are always the same string.
 */
export function normalizeMatchPattern(input: unknown): string | null {
  return parseMatchPattern(input)?.source ?? null;
}

/**
 * Widens a pattern to cover everything under its path.
 *
 * Exists so the pin editor can offer widening as a visible, reversible choice
 * rather than doing it silently during parsing. Idempotent: a pattern that
 * already ends in `*` is returned unchanged, so ticking the option twice cannot
 * produce `/**`.
 */
export function widenToPrefix(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.endsWith('*')) return trimmed;
  // No path yet: append `/*` for the whole site, rather than a bare `*`, which
  // would produce `example.com*` and also cover `example.community`.
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

/** Tests one already-parsed pattern against a URL. */
export function matchesPattern(pattern: MatchPattern, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  // Only http(s) is ever pinnable, so `about:`, `moz-extension:` and friends
  // never match — including the extension's own full-page view.
  if (!(CONCRETE_SCHEMES as readonly string[]).includes(scheme)) return false;
  if (pattern.scheme !== null && pattern.scheme !== scheme) return false;

  if (pattern.host !== null) {
    const host = parsed.hostname.toLowerCase();
    if (pattern.matchSubdomains) {
      // A dotted suffix test, not a bare one, so `*.example.com` cannot be
      // satisfied by `notexample.com`.
      if (host !== pattern.host && !host.endsWith(`.${pattern.host}`)) return false;
    } else if (host !== pattern.host) {
      return false;
    }
  }

  // `search` carries its own `?`, so this is the URL text after the host with
  // the fragment dropped — what the specification matches against.
  return pattern.path.test(`${parsed.pathname}${parsed.search}`);
}

/**
 * Whether a URL satisfies any pattern in a pin.
 *
 * An empty list means "not pinned", which is why this returns `false` and
 * callers treat an unpinned item as always visible rather than routing it here.
 */
export function matchesAnyPattern(patterns: readonly string[], url: string | null): boolean {
  if (!url || patterns.length === 0) return false;
  return patterns.some((source) => {
    const pattern = parseMatchPattern(source);
    return pattern !== null && matchesPattern(pattern, url);
  });
}

/**
 * Cleans a stored or imported pattern list.
 *
 * Invalid entries are dropped rather than rejected: a backup written by a newer
 * version, or hand-edited, should still import the pins it got right instead of
 * failing as a whole. Duplicates collapse because normalisation makes
 * `example.com` and `*://example.com/*` the same string.
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

/**
 * A short human description of what a pattern covers, for the pin list.
 *
 * Phrased as a noun rather than a sentence so it reads correctly next to the
 * pattern text itself.
 */
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
