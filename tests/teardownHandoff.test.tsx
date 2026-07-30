import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * What happens to unsaved text when the document is destroyed.
 *
 * The distinction under test is not cosmetic. In a Firefox sidebar or a browser
 * tab, `pagehide` still allows an `await`, so autosave writes on the way out. A
 * Chrome toolbar popup is torn down the moment it loses focus and takes its
 * IndexedDB connection with it, so a write started there may never commit —
 * which is why that build hands the queue to its service worker instead.
 *
 * Both paths have to be exercised through the real provider, because the bug
 * this guards against is "the wrong branch ran", and only mounting the thing can
 * tell you which one did.
 */

vi.mock('../src/editor/RichTextEditor', () => ({
  RichTextEditor: ({ noteId }: { noteId: string }) => (
    <div data-note-id={noteId} aria-label="Note content" />
  ),
}));

const { resetDatabase, doc } = await import('./helpers');
const { App } = await import('../src/app/App');
const { WorkspaceProvider } = await import('../src/app/WorkspaceProvider');
const { ToastProvider } = await import('../src/components/ToastProvider');
const { DEFAULT_PREFERENCES } = await import('../src/services/preferences');
const { ensureSeeded } = await import('../src/services/workspaceService');
const { openDatabase } = await import('../src/database/db');
const { createTab } = await import('../src/database/tabsRepository');
const { createNote, getNote } = await import('../src/database/notesRepository');
const { saveQueue } = await import('../src/services/saveQueue');
const { setTeardownHandoff } = await import('../src/services/teardown');

beforeEach(async () => {
  await resetDatabase();
  await openDatabase();
  await ensureSeeded();
});

afterEach(() => {
  setTeardownHandoff(null);
});

async function renderApp() {
  render(
    <ToastProvider>
      <WorkspaceProvider initialPreferences={{ ...DEFAULT_PREFERENCES }}>
        <App />
      </WorkspaceProvider>
    </ToastProvider>,
  );
  await waitFor(() => expect(screen.queryByText(/Opening your notes/)).toBeNull());
}

/** A note with text queued but not yet written. */
async function queueUnsavedText(text: string) {
  const tab = await createTab({ title: 'Tab' });
  const note = await createNote({ tabId: tab.id, title: 'Note' });
  saveQueue.setBaseVersion(note.id, note.updatedAt);
  saveQueue.schedule(note.id, { content: doc(text), plainText: text });
  return note;
}

describe('without a handoff (Firefox)', () => {
  it('writes queued text in place on pagehide', async () => {
    await renderApp();
    const note = await queueUnsavedText('typed in the sidebar');

    window.dispatchEvent(new Event('pagehide'));

    await waitFor(async () => {
      expect((await getNote(note.id))?.plainText).toBe('typed in the sidebar');
    });
  });
});

describe('with a handoff installed (Chrome)', () => {
  it('gives the queue away instead of writing it here', async () => {
    const handoff = vi.fn();
    setTeardownHandoff(handoff);
    await renderApp();
    const note = await queueUnsavedText('typed in the popup');

    window.dispatchEvent(new Event('pagehide'));

    expect(handoff).toHaveBeenCalledTimes(1);
    const writes = handoff.mock.calls[0][0] as {
      noteId: string;
      expectedUpdatedAt: number | null;
      patch: { plainText?: string };
    }[];
    expect(writes).toHaveLength(1);
    expect(writes[0].noteId).toBe(note.id);
    expect(writes[0].patch.plainText).toBe('typed in the popup');
    expect(writes[0].expectedUpdatedAt).toBe(note.updatedAt);

    // Crucially it did *not* also write in place. A doomed transaction started
    // here would race the worker and could resurrect stale text.
    expect((await getNote(note.id))?.plainText).toBe('');
  });

  it('hands off once even though pagehide and beforeunload both fire', async () => {
    const handoff = vi.fn();
    setTeardownHandoff(handoff);
    await renderApp();
    await queueUnsavedText('typed once');

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));

    // The snapshot empties the queue, so the second event finds nothing and the
    // patch is never sent — or applied — twice.
    expect(handoff).toHaveBeenCalledTimes(1);
  });

  it('stays silent when there is nothing queued', async () => {
    const handoff = vi.fn();
    setTeardownHandoff(handoff);
    await renderApp();

    window.dispatchEvent(new Event('pagehide'));

    expect(handoff).not.toHaveBeenCalled();
  });

  it('still writes in place when the document is merely hidden', async () => {
    // `visibilitychange` is survivable: the popup is gone by the time it would
    // matter, but a full-page tab is not, and writing there is correct.
    const handoff = vi.fn();
    setTeardownHandoff(handoff);
    await renderApp();
    const note = await queueUnsavedText('typed then hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(async () => {
      expect((await getNote(note.id))?.plainText).toBe('typed then hidden');
    });
    expect(handoff).not.toHaveBeenCalled();
  });
});
