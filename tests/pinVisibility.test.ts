import { describe, expect, it } from 'vitest';
import {
  isPinned,
  isVisible,
  pinsActive,
  resolveNoteAfterPinChange,
  resolveTabAfterPinChange,
  selectVisible,
  type PinContext,
} from '../src/services/pinVisibility';
import type { NoteMeta, NoteTab } from '../src/types';

const YOUTUBE = 'https://www.youtube.com/watch?v=eDQtUwad5vg';

function context(overrides: Partial<PinContext> = {}): PinContext {
  return { activeUrl: YOUTUBE, granted: true, showHidden: false, inert: false, ...overrides };
}

function tab(id: string, urlPatterns?: string[]): NoteTab {
  return {
    id,
    title: id,
    color: '#64748b',
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    ...(urlPatterns ? { urlPatterns } : {}),
  };
}

function note(id: string, urlPatterns?: string[]): NoteMeta {
  return {
    id,
    tabId: 'general',
    title: id,
    color: '#64748b',
    plainText: '',
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    ...(urlPatterns ? { urlPatterns } : {}),
  };
}

describe('when pins apply at all', () => {
  it('applies once the permission is held', () => {
    expect(pinsActive(context())).toBe(true);
  });

  it('does not apply without the tabs permission', () => {
    expect(pinsActive(context({ granted: false }))).toBe(false);
  });

  it('does not apply while "show hidden" is on', () => {
    expect(pinsActive(context({ showHidden: true }))).toBe(false);
  });

  it('does not apply in the full-page view', () => {
    expect(pinsActive(context({ inert: true }))).toBe(false);
  });
});

describe('single-item visibility', () => {
  it('always shows an unpinned item', () => {
    expect(isPinned(tab('a'))).toBe(false);
    expect(isVisible(tab('a'), context({ activeUrl: 'https://example.com/' }))).toBe(true);
  });

  it('shows a pinned item only on a matching page', () => {
    const pinned = tab('yt', ['https://*.youtube.com/*']);
    expect(isVisible(pinned, context())).toBe(true);
    expect(isVisible(pinned, context({ activeUrl: 'https://example.com/' }))).toBe(false);
  });

  it('fails open, never closed, when the permission is missing', () => {
    const pinned = tab('yt', ['https://*.youtube.com/*']);
    // The direction that matters: someone who declines the permission must
    // still see all of their notes, not none of them.
    expect(isVisible(pinned, context({ granted: false, activeUrl: null }))).toBe(true);
  });

  it('hides a pinned item while the open page is not a web page', () => {
    // Permission held, but the active tab is `about:config` or similar, so
    // there is no URL. The user is genuinely not on the pinned page, and the
    // "show hidden" toggle is the way back.
    const pinned = tab('yt', ['https://*.youtube.com/*']);
    expect(isVisible(pinned, context({ activeUrl: null }))).toBe(false);
  });
});

describe('filtering the workspace', () => {
  const tabs = [
    tab('general'),
    tab('yt', ['https://*.youtube.com/*']),
    tab('gh', ['github.com/*']),
  ];

  it('hides tabs whose pin does not match', () => {
    const result = selectVisible(tabs, [], 'general', null, context());
    expect(result.tabs.map((t) => t.id)).toEqual(['general', 'yt']);
    expect(result.hiddenTabCount).toBe(1);
  });

  it('shows everything when pins are inert', () => {
    const result = selectVisible(tabs, [], 'general', null, context({ inert: true }));
    expect(result.tabs).toHaveLength(3);
    expect(result.hiddenTabCount).toBe(0);
  });

  it('shows everything while "show hidden" is on', () => {
    const result = selectVisible(tabs, [], 'general', null, context({ showHidden: true }));
    expect(result.tabs).toHaveLength(3);
    expect(result.hiddenTabCount).toBe(0);
  });

  it('keeps an explicitly revealed tab in the strip', () => {
    const result = selectVisible(tabs, [], 'gh', null, context());
    expect(result.tabs.map((t) => t.id)).toContain('gh');
    // Still counted, so the indicator explains why it looks different.
    expect(result.hiddenTabCount).toBe(1);
  });

  it('filters notes independently of tabs', () => {
    const notes = [
      note('plain'),
      note('yt', ['https://*.youtube.com/*']),
      note('gh', ['gh.test/*']),
    ];
    const result = selectVisible([], notes, null, null, context());
    expect(result.notes.map((n) => n.id)).toEqual(['plain', 'yt']);
    expect(result.hiddenNoteCount).toBe(1);
  });

  /*
   * Regression. An earlier version exempted the *selected* note, which meant a
   * note pinned while you were reading it stayed selected, stayed exempt, and
   * so never hid — the feature did nothing for the most obvious way to use it.
   * Only an explicit reveal exempts anything now.
   */
  it('hides a pinned note even while it is the one selected', () => {
    const notes = [note('plain'), note('gh', ['gh.test/*'])];
    const result = selectVisible([], notes, null, null, context());
    expect(result.notes.map((n) => n.id)).toEqual(['plain']);
    expect(result.hiddenNoteCount).toBe(1);
  });

  it('keeps a note exempt only when it was explicitly revealed', () => {
    // What makes a search result in a hidden tab openable: search looks past
    // pins, so opening a result must not bounce the selection away.
    const notes = [note('plain'), note('gh', ['gh.test/*'])];
    const result = selectVisible([], notes, null, 'gh', context());
    expect(result.notes.map((n) => n.id)).toEqual(['plain', 'gh']);
    expect(result.hiddenNoteCount).toBe(1);
  });
});

describe('choosing a note after a pin hides the current one', () => {
  it('stays put when nothing is hidden', () => {
    expect(resolveNoteAfterPinChange([note('plain')], 'plain', context())).toBeNull();
  });

  it('steps off a note the pin no longer matches', () => {
    const notes = [note('gh', ['gh.test/*']), note('plain')];
    expect(resolveNoteAfterPinChange(notes, 'gh', context())).toBe('plain');
  });

  it('prefers a note pinned to the page now open', () => {
    const notes = [note('gh', ['gh.test/*']), note('plain'), note('yt', ['*.youtube.com/*'])];
    expect(resolveNoteAfterPinChange(notes, 'gh', context())).toBe('yt');
  });

  it('stays put when pins are not being enforced', () => {
    const notes = [note('gh', ['gh.test/*']), note('plain')];
    expect(resolveNoteAfterPinChange(notes, 'gh', context({ granted: false }))).toBeNull();
  });

  it('stays put when every note is hidden', () => {
    const notes = [note('gh', ['gh.test/*']), note('so', ['so.test/*'])];
    expect(resolveNoteAfterPinChange(notes, 'gh', context())).toBeNull();
  });
});

describe('choosing a tab after a pin hides the current one', () => {
  it('stays put when nothing is hidden', () => {
    const tabs = [tab('general')];
    expect(resolveTabAfterPinChange(tabs, 'general', context())).toBeNull();
  });

  it('stays put when pins are not being enforced', () => {
    const tabs = [tab('gh', ['github.com/*']), tab('general')];
    expect(resolveTabAfterPinChange(tabs, 'gh', context({ granted: false }))).toBeNull();
  });

  it('prefers a tab pinned to the page now open', () => {
    const tabs = [tab('general'), tab('gh', ['github.com/*']), tab('yt', ['*.youtube.com/*'])];
    expect(resolveTabAfterPinChange(tabs, 'gh', context())).toBe('yt');
  });

  it('falls back to any visible tab when none is pinned to this page', () => {
    const tabs = [tab('general'), tab('gh', ['github.com/*'])];
    expect(resolveTabAfterPinChange(tabs, 'gh', context())).toBe('general');
  });

  it('stays put when every tab is hidden, rather than trading one empty view for another', () => {
    const tabs = [tab('gh', ['github.com/*']), tab('so', ['stackoverflow.com/*'])];
    expect(resolveTabAfterPinChange(tabs, 'gh', context())).toBeNull();
  });
});
