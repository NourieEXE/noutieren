import { describe, expect, it } from 'vitest';
import {
  ALL_URLS,
  MAX_PATTERNS_PER_PIN,
  describePattern,
  isWildcardPattern,
  matchesAnyPattern,
  normalizeMatchPattern,
  parsePattern,
  sanitizePatternList,
  widenToPrefix,
} from '../src/utils/matchPattern';

/** Reads better than `matchesAnyPattern([p], url)` at every call site below. */
const matches = (pattern: string, url: string): boolean => matchesAnyPattern([pattern], url);

describe('normalising patterns', () => {
  /*
   * The rule this group exists to protect: normalisation never widens a
   * pattern. Filling a missing path with `/*` would mean a pin came back
   * covering more than the address that was typed, which is a surprise in the
   * one direction that matters. Widening is opt-in, via `widenToPrefix`.
   */
  it('completes a missing path to the root, not to a wildcard', () => {
    expect(normalizeMatchPattern('https://example.com')).toBe('https://example.com/');
  });

  it('completes a bare host to any scheme, still without widening', () => {
    expect(normalizeMatchPattern('example.com')).toBe('*://example.com/');
    expect(normalizeMatchPattern('*.example.com')).toBe('*://*.example.com/');
  });

  it('leaves an explicit path exactly as typed', () => {
    expect(normalizeMatchPattern('https://example.com/')).toBe('https://example.com/');
    expect(normalizeMatchPattern('https://example.com/*')).toBe('https://example.com/*');
    expect(normalizeMatchPattern('https://www.youtube.com/')).toBe('https://www.youtube.com/');
  });

  it('lowercases the scheme and host but not the path', () => {
    expect(normalizeMatchPattern('HTTPS://Example.COM/Watch')).toBe('https://example.com/Watch');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeMatchPattern('  https://example.com/*  ')).toBe('https://example.com/*');
  });
});

describe('rejecting patterns', () => {
  const rejected: ReadonlyArray<[string, unknown]> = [
    ['empty input', ''],
    ['whitespace only', '   '],
    ['a non-string', 42],
    ['null', null],
    ['a javascript URL', 'javascript://example.com/*'],
    ['a file URL', 'file:///home/user/*'],
    ['an extension URL', 'moz-extension://abc/*'],
    ['a scheme with a single slash', 'http:/example.com'],
    ['an interior host wildcard', 'https://exa*ple.com/*'],
    ['a trailing host wildcard', 'https://example.*/*'],
    ['a bare "*." with no domain', 'https://*./*'],
    ['a port', 'https://example.com:8080/*'],
    ['a fragment', 'https://example.com/page#section'],
    // Has no "://", so it would otherwise be read as a bare hostname.
    ['a scheme-less javascript payload', 'javascript:alert(1)'],
    ['a host with spaces', 'my site.com'],
    ['a host that is only dots', '...'],
    ['a host with a trailing dot', 'example.com.'],
    ['too many wildcards', `https://example.com/${'*/'.repeat(12)}`],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(parsePattern(value).ok).toBe(false);
      expect(normalizeMatchPattern(value)).toBeNull();
    });
  }

  it('explains why, without restating the grammar', () => {
    const result = parsePattern('ftp://example.com/*');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('ftp');
  });
});

describe('scheme matching', () => {
  it('binds an explicit scheme', () => {
    expect(matches('https://example.com/*', 'https://example.com/page')).toBe(true);
    expect(matches('https://example.com/*', 'http://example.com/page')).toBe(false);
  });

  it('treats * as http or https only', () => {
    expect(matches('*://example.com/*', 'http://example.com/')).toBe(true);
    expect(matches('*://example.com/*', 'https://example.com/')).toBe(true);
  });

  it('never matches a non-web URL, so the full-page view is not pinnable', () => {
    expect(matches('*://*/*', 'moz-extension://abc123/index.html?view=page')).toBe(false);
    expect(matches('*://*/*', 'about:blank')).toBe(false);
    expect(matches(ALL_URLS, 'chrome://extensions')).toBe(false);
  });
});

describe('host matching', () => {
  it('matches an exact host and nothing else', () => {
    expect(matches('https://example.com/*', 'https://example.com/')).toBe(true);
    expect(matches('https://example.com/*', 'https://www.example.com/')).toBe(false);
  });

  it('matches subdomains and the apex domain with *.', () => {
    expect(matches('https://*.example.com/*', 'https://example.com/')).toBe(true);
    expect(matches('https://*.example.com/*', 'https://www.example.com/')).toBe(true);
    expect(matches('https://*.example.com/*', 'https://a.b.example.com/')).toBe(true);
  });

  it('does not let *.example.com be satisfied by a lookalike suffix', () => {
    expect(matches('https://*.example.com/*', 'https://notexample.com/')).toBe(false);
    expect(matches('https://*.example.com/*', 'https://evil-example.com/')).toBe(false);
    expect(matches('https://*.example.com/*', 'https://example.com.evil.test/')).toBe(false);
  });

  it('compares hosts case-insensitively', () => {
    expect(matches('https://example.com/*', 'https://EXAMPLE.COM/')).toBe(true);
  });

  it('ignores the port on the visited URL', () => {
    expect(matches('http://localhost/*', 'http://localhost:5173/index.html')).toBe(true);
  });
});

describe('path matching', () => {
  it('distinguishes a trailing slash from a trailing wildcard', () => {
    expect(matches('https://example.com/', 'https://example.com/')).toBe(true);
    expect(matches('https://example.com/', 'https://example.com/page')).toBe(false);

    expect(matches('https://example.com/*', 'https://example.com/')).toBe(true);
    expect(matches('https://example.com/*', 'https://example.com/page')).toBe(true);
  });

  it('matches a prefix path', () => {
    expect(matches('https://example.com/docs/*', 'https://example.com/docs/intro')).toBe(true);
    expect(matches('https://example.com/docs/*', 'https://example.com/blog/intro')).toBe(false);
  });

  it('compares paths case-sensitively', () => {
    expect(matches('https://example.com/Docs', 'https://example.com/Docs')).toBe(true);
    expect(matches('https://example.com/Docs', 'https://example.com/docs')).toBe(false);
  });

  it('matches the query string, treating ? and = literally', () => {
    const pin = 'https://www.youtube.com/watch?v=eDQtUwad5vg';
    expect(matches(pin, 'https://www.youtube.com/watch?v=eDQtUwad5vg')).toBe(true);
    expect(matches(pin, 'https://www.youtube.com/watch?v=different')).toBe(false);
    // A literal `?` must not be read as "the preceding character is optional".
    expect(matches(pin, 'https://www.youtube.com/watchv=eDQtUwad5vg')).toBe(false);
  });

  it('ignores the fragment on the visited URL', () => {
    expect(matches('https://example.com/page', 'https://example.com/page#section')).toBe(true);
  });

  it('treats regex metacharacters in a path literally', () => {
    expect(matches('https://example.com/a.b', 'https://example.com/a.b')).toBe(true);
    expect(matches('https://example.com/a.b', 'https://example.com/axb')).toBe(false);
    expect(matches('https://example.com/a+b', 'https://example.com/a+b')).toBe(true);
    expect(matches('https://example.com/(x)', 'https://example.com/(x)')).toBe(true);
  });

  it('handles a wildcard in the middle of a path', () => {
    expect(matches('https://example.com/a/*/z', 'https://example.com/a/m/z')).toBe(true);
    expect(matches('https://example.com/a/*/z', 'https://example.com/a/m/n/z')).toBe(true);
    expect(matches('https://example.com/a/*/z', 'https://example.com/a/m/y')).toBe(false);
  });

  it('handles a literal space in a path', () => {
    expect(matches('https://example.com/my page', 'https://example.com/my%20page')).toBe(false);
    expect(matches('https://example.com/my%20page', 'https://example.com/my page')).toBe(true);
  });
});

describe('widening, which is always opt-in', () => {
  it('turns an exact address into a prefix', () => {
    expect(widenToPrefix('https://www.youtube.com/')).toBe('https://www.youtube.com/*');
    expect(widenToPrefix('https://example.com/docs/')).toBe('https://example.com/docs/*');
  });

  it('adds a path when there is none, rather than a bare star', () => {
    // `example.com*` would also cover `example.community`.
    expect(widenToPrefix('example.com')).toBe('example.com/*');
    expect(widenToPrefix('https://example.com')).toBe('https://example.com/*');
  });

  it('is idempotent, so ticking the option twice cannot produce "/**"', () => {
    expect(widenToPrefix('https://example.com/*')).toBe('https://example.com/*');
    expect(widenToPrefix(widenToPrefix('https://example.com/'))).toBe('https://example.com/*');
  });

  it('leaves an empty draft alone', () => {
    expect(widenToPrefix('   ')).toBe('');
  });

  it('reports which patterns actually cover more than one address', () => {
    expect(isWildcardPattern('https://example.com/')).toBe(false);
    expect(isWildcardPattern('https://example.com/exact')).toBe(false);
    expect(isWildcardPattern('https://example.com/*')).toBe(true);
    expect(isWildcardPattern('https://example.com/a/*/z')).toBe(true);
  });
});

describe("the user's own examples", () => {
  const video = 'https://www.youtube.com/watch?v=eDQtUwad5vg';

  it('pins to one exact video', () => {
    expect(matches(video, video)).toBe(true);
    expect(matches(video, 'https://www.youtube.com/watch?v=other')).toBe(false);
    expect(matches(video, 'https://www.youtube.com/')).toBe(false);
  });

  it('pins to the YouTube home page only', () => {
    expect(matches('https://*.youtube.com/', 'https://www.youtube.com/')).toBe(true);
    expect(matches('https://*.youtube.com/', video)).toBe(false);
  });

  it('does not silently widen the address that was typed', () => {
    // Reported: typing this came back as `https://www.youtube.com/*`.
    const typed = 'https://www.youtube.com/';
    expect(normalizeMatchPattern(typed)).toBe(typed);
    expect(matches(typed, video)).toBe(false);
    expect(matches(typed, 'https://www.youtube.com/')).toBe(true);
  });

  it('pins to all of YouTube', () => {
    expect(matches('https://*.youtube.com/*', 'https://www.youtube.com/')).toBe(true);
    expect(matches('https://*.youtube.com/*', video)).toBe(true);
    expect(matches('https://*.youtube.com/*', 'https://music.youtube.com/library')).toBe(true);
    expect(matches('https://*.youtube.com/*', 'https://vimeo.com/')).toBe(false);
  });
});

describe('pattern lists', () => {
  it('is not matched by an empty list, so an unpinned item is never routed here', () => {
    expect(matchesAnyPattern([], 'https://example.com/')).toBe(false);
  });

  it('is not matched when no URL is known', () => {
    expect(matchesAnyPattern(['https://example.com/*'], null)).toBe(false);
  });

  it('matches when any one pattern matches', () => {
    const pins = ['https://example.com/*', 'https://*.youtube.com/*'];
    expect(matchesAnyPattern(pins, 'https://music.youtube.com/')).toBe(true);
    expect(matchesAnyPattern(pins, 'https://unrelated.test/')).toBe(false);
  });

  it('skips invalid entries instead of throwing', () => {
    expect(matchesAnyPattern(['not a pattern', 'https://example.com/*'], 'https://example.com/')) //
      .toBe(true);
  });

  it('ignores a malformed visited URL', () => {
    expect(matchesAnyPattern(['*://*/*'], 'not a url')).toBe(false);
  });
});

describe('sanitizing stored lists', () => {
  it('drops invalid entries but keeps the valid ones', () => {
    expect(sanitizePatternList(['https://example.com/*', 'javascript:alert(1)', 7])).toEqual([
      'https://example.com/*',
    ]);
  });

  it('collapses duplicates that normalise to the same pattern', () => {
    expect(sanitizePatternList(['example.com', '*://example.com/'])).toEqual(['*://example.com/']);
  });

  it('keeps the exact and the widened form apart, because they differ', () => {
    expect(sanitizePatternList(['*://example.com/', '*://example.com/*'])).toHaveLength(2);
  });

  it('returns an empty list for anything that is not an array', () => {
    for (const value of [null, undefined, 'https://example.com/*', {}, 3]) {
      expect(sanitizePatternList(value)).toEqual([]);
    }
  });

  it('caps the number of stored patterns', () => {
    const many = Array.from(
      { length: MAX_PATTERNS_PER_PIN + 10 },
      (_, i) => `https://h${i}.test/*`,
    );
    expect(sanitizePatternList(many)).toHaveLength(MAX_PATTERNS_PER_PIN);
  });
});

describe('describing patterns', () => {
  it('describes each shape a pin can take', () => {
    expect(describePattern('https://example.com/*')).toBe('example.com');
    expect(describePattern('https://example.com/')).toBe('example.com, home page only');
    expect(describePattern('https://*.youtube.com/*')).toBe('youtube.com and its subdomains');
    expect(describePattern('https://example.com/docs/*')).toBe('example.com/docs/…');
    expect(describePattern('https://example.com/exact')).toBe('example.com/exact, exactly');
    expect(describePattern('*://*/*')).toBe('Any website');
    expect(describePattern(ALL_URLS)).toBe('Any website');
  });

  it('says so rather than throwing when a stored pattern is unreadable', () => {
    expect(describePattern('nonsense://')).toBe('Invalid pattern');
  });
});
