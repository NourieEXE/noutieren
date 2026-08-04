import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canPromptForPermission,
  hasTabsPermission,
  requestTabsPermission,
  subscribeToActiveUrl,
} from '../src/services/activeTabUrl';
import { openFullPageEditor, wantsPinPermissionGrant } from '../src/services/webext';

/**
 * The optional `tabs` permission, and the one place the two browsers genuinely
 * differ: Chrome cannot raise a permission dialog from its toolbar popup.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The stub installed by `stubBrowser`, typed for inspection.
 *
 * `chrome` is declared globally as the real `Browser` shape, so reaching its
 * vitest mocks needs a cast; doing it here keeps the assertions readable.
 */
function stubbed<T>(): T {
  return chrome as unknown as T;
}

/** A minimal extension API. `runtime.id` is what marks it as a real one. */
function stubBrowser(overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension' },
    permissions: {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ url: 'https://example.com/page', active: true }]),
      create: vi.fn().mockResolvedValue({}),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: { onFocusChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    ...overrides,
  });
}

describe('which surfaces can raise the permission dialog', () => {
  /*
   * The reason this exists at all: Chrome destroys the toolbar popup when it
   * loses focus, which is precisely what opening a permission dialog does. The
   * request cannot fail gracefully there — the document is gone before the user
   * answers — so the popup must not try.
   */
  it('refuses to prompt from a toolbar popup', () => {
    expect(canPromptForPermission('popup')).toBe(false);
  });

  it('prompts from a sidebar, which Firefox keeps open', () => {
    expect(canPromptForPermission('sidebar')).toBe(true);
  });

  it('prompts from the full page, which is an ordinary tab', () => {
    expect(canPromptForPermission('page')).toBe(true);
  });
});

describe('the full-page grant hand-off', () => {
  /*
   * What went wrong the first time this shipped: the popup opened the full page
   * with no flag, so the tab arrived on the ordinary editor, asked for nothing,
   * and looked like it had opened at random.
   */
  it('marks a tab opened to ask for the permission', () => {
    expect(wantsPinPermissionGrant('?view=page&grant=pins')).toBe(true);
  });

  it('does not mark an ordinary full-page tab', () => {
    expect(wantsPinPermissionGrant('?view=page')).toBe(false);
    expect(wantsPinPermissionGrant('')).toBe(false);
    expect(wantsPinPermissionGrant('?grant=something-else')).toBe(false);
  });

  it('opens the flagged URL, keeping the view parameter intact', async () => {
    stubBrowser({ runtime: { id: 'x', getURL: (p: string) => `chrome-extension://x/${p}` } });
    await openFullPageEditor({ forPinGrant: true });

    const api = stubbed<{ tabs: { create: { mock: { calls: { url: string }[][] } } } }>();
    const url = api.tabs.create.mock.calls[0][0].url;
    expect(url).toContain('view=page');
    expect(url).toContain('grant=pins');
    // The flag must survive a round trip through the URL it was written into.
    expect(wantsPinPermissionGrant(new URL(url).search)).toBe(true);
  });

  it('opens an unflagged URL for the ordinary "Full page" button', async () => {
    stubBrowser({ runtime: { id: 'x', getURL: (p: string) => `chrome-extension://x/${p}` } });
    await openFullPageEditor();

    const api = stubbed<{ tabs: { create: { mock: { calls: { url: string }[][] } } } }>();
    expect(api.tabs.create.mock.calls[0][0].url).not.toContain('grant=');
  });
});

describe('reading the permission', () => {
  it('reports "not held" with no extension API at all', async () => {
    expect(await hasTabsPermission()).toBe(false);
  });

  it('never throws when the browser refuses the query', async () => {
    stubBrowser({
      permissions: {
        contains: vi.fn().mockRejectedValue(new Error('nope')),
        request: vi.fn(),
        remove: vi.fn(),
        onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    expect(await hasTabsPermission()).toBe(false);
  });

  it('asks for exactly the tabs permission and nothing else', async () => {
    stubBrowser();
    await requestTabsPermission();

    const api = stubbed<{ permissions: { request: { mock: { calls: unknown[][] } } } }>();
    expect(api.permissions.request.mock.calls[0][0]).toEqual({ permissions: ['tabs'] });
  });

  it('reports a refusal as false rather than throwing', async () => {
    stubBrowser({
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockRejectedValue(new Error('gesture required')),
        remove: vi.fn(),
        onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    expect(await requestTabsPermission()).toBe(false);
  });
});

describe('watching the active URL', () => {
  it('reports "not granted, no URL" outside an extension', () => {
    const seen: unknown[] = [];
    const stop = subscribeToActiveUrl((state) => seen.push(state));
    expect(seen).toEqual([{ url: null, granted: false }]);
    stop();
  });

  it('reads the URL once the permission is held', async () => {
    stubBrowser({
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn(),
        remove: vi.fn(),
        onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });

    const seen: { url: string | null; granted: boolean }[] = [];
    const stop = subscribeToActiveUrl((state) => seen.push(state));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));

    expect(seen.at(-1)).toEqual({ url: 'https://example.com/page', granted: true });
    stop();
  });

  it('drops a URL that is not a web page, so no pin can match one', async () => {
    stubBrowser({
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn(),
        remove: vi.fn(),
        onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ url: 'chrome://extensions', active: true }]),
        create: vi.fn(),
        onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });

    const seen: { url: string | null; granted: boolean }[] = [];
    const stop = subscribeToActiveUrl((state) => seen.push(state));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));

    expect(seen.at(-1)).toEqual({ url: null, granted: true });
    stop();
  });

  it('unsubscribes from every event it subscribed to', () => {
    stubBrowser();
    const stop = subscribeToActiveUrl(() => undefined);
    stop();

    const api = stubbed<{
      tabs: { onActivated: { removeListener: { mock: { calls: unknown[] } } } };
      windows: { onFocusChanged: { removeListener: { mock: { calls: unknown[] } } } };
      permissions: { onRemoved: { removeListener: { mock: { calls: unknown[] } } } };
    }>();
    expect(api.tabs.onActivated.removeListener.mock.calls).toHaveLength(1);
    expect(api.windows.onFocusChanged.removeListener.mock.calls).toHaveLength(1);
    expect(api.permissions.onRemoved.removeListener.mock.calls).toHaveLength(1);
  });
});
