import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RELEASES } from '../src/releaseNotes';
import { WhatsNewPage } from '../src/components/WhatsNewPage';
import { fullPagePath, requestedShow, type BrowserApi } from '../src/services/webext';
import { recordUpdate } from '../src/services/whatsNew';
import { UpdateNotice } from '../src/components/UpdateNotice';

const changelog = [
  ...readFileSync('CHANGELOG.md', 'utf8').matchAll(/^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})/gm),
].map(([, version, date]) => ({ version, date }));

describe('release notes', () => {
  it('cover every version in the changelog, with the same dates, newest first', () => {
    expect(RELEASES.map(({ version, date }) => ({ version, date }))).toEqual(changelog);
  });

  it('start with the version being built, so a release cannot ship without notes', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(RELEASES[0].version).toBe(version);
  });

  it('have something to say for every version', () => {
    for (const release of RELEASES) expect(release.notes.length).toBeGreaterThan(0);
  });
});

describe("the What's new page", () => {
  it('lists every version, newest first', () => {
    render(<WhatsNewPage />);

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.firstChild?.textContent)).toEqual(
      RELEASES.map((release) => release.version),
    );
  });

  it('opens in the full-page view', () => {
    expect(fullPagePath({ show: 'whats-new' })).toBe('index.html?view=page&show=whats-new');
    expect(requestedShow('?view=page&show=whats-new')).toBe('whats-new');
    expect(requestedShow('?view=page')).toBeNull();
  });
});

/** Extension storage and the bits of `runtime` the notice reads. */
function fakeExtension(stored: Record<string, unknown> = {}, version = '1.5.0') {
  const store = { ...stored };
  const api = {
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ version }),
      getURL: (path: string) => `ext://noutieren/${path}`,
    },
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {})),
        set: vi.fn((items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete store[key];
          return Promise.resolve();
        }),
      },
    },
    tabs: { create: vi.fn(() => Promise.resolve({})) },
  };
  return { api, store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('noticing an update', () => {
  it('remembers the version it updated from', async () => {
    const { api, store } = fakeExtension();
    await recordUpdate(api as unknown as BrowserApi, {
      reason: 'update',
      previousVersion: '1.4.0',
      temporary: false,
    });
    expect(store.updatedFrom).toBe('1.4.0');
  });

  it('says nothing after a fresh install, or a reload of the same version', async () => {
    const { api, store } = fakeExtension();
    await recordUpdate(api as unknown as BrowserApi, { reason: 'install', temporary: false });
    await recordUpdate(api as unknown as BrowserApi, {
      reason: 'update',
      previousVersion: '1.5.0',
      temporary: false,
    });
    expect(store).toEqual({});
  });

  it('keeps the oldest version when updates pile up unseen', async () => {
    const { api, store } = fakeExtension({ updatedFrom: '1.3.0' });
    await recordUpdate(api as unknown as BrowserApi, {
      reason: 'update',
      previousVersion: '1.4.0',
      temporary: false,
    });
    expect(store.updatedFrom).toBe('1.3.0');
  });
});

describe('the update line', () => {
  it('shows once after an update and goes away when dismissed', async () => {
    const { api, store } = fakeExtension({ updatedFrom: '1.4.0' });
    vi.stubGlobal('chrome', api);
    const user = userEvent.setup();
    render(<UpdateNotice />);

    expect(await screen.findByText('Noutieren was updated to 1.5.0.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(store.updatedFrom).toBeUndefined());
  });

  it("opens What's new, and counts that as seen", async () => {
    const { api, store } = fakeExtension({ updatedFrom: '1.4.0' });
    vi.stubGlobal('chrome', api);
    const user = userEvent.setup();
    render(<UpdateNotice />);

    await user.click(await screen.findByRole('button', { name: "See what's new" }));

    expect(api.tabs.create).toHaveBeenCalledWith({
      url: 'ext://noutieren/index.html?view=page&show=whats-new',
    });
    await waitFor(() => expect(store.updatedFrom).toBeUndefined());
  });

  it('stays hidden when there was no update', async () => {
    vi.stubGlobal('chrome', fakeExtension().api);
    render(<UpdateNotice />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
