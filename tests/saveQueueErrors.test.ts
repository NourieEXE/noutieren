import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatchResult } from '../src/database/notesRepository';

/**
 * Storage-failure behaviour for the autosave queue.
 *
 * The repository is mocked here so a write can be made to fail on demand; the
 * rule under test is that typed text is never thrown away when a save fails.
 */
const applyNotePatch = vi.hoisted(() => vi.fn());

vi.mock('../src/database/notesRepository', () => ({ applyNotePatch }));

const { SaveQueue } = await import('../src/services/saveQueue');

const NOTE = 'note-1';

let queue: InstanceType<typeof SaveQueue>;

beforeEach(() => {
  applyNotePatch.mockReset();
  queue = new SaveQueue({ debounceMs: 10 });
});

function saved(updatedAt = 1000): PatchResult {
  return { status: 'saved', updatedAt };
}

describe('storage failures', () => {
  it('keeps the patch queued and surfaces an error', async () => {
    applyNotePatch.mockRejectedValueOnce(new DOMException('disk is full', 'QuotaExceededError'));

    queue.schedule(NOTE, { title: 'typed text' });
    await queue.flush(NOTE);

    const status = queue.getStatus();
    expect(status.state).toBe('error');
    expect(status.errorMessage).toMatch(/storage space/i);
    // The text is still queued, not lost.
    expect(queue.peekPending(NOTE)).toEqual({ title: 'typed text' });
  });

  it('retries the kept patch on the next flush and recovers', async () => {
    applyNotePatch
      .mockRejectedValueOnce(new DOMException('disk is full', 'QuotaExceededError'))
      .mockResolvedValueOnce(saved(2000));

    queue.schedule(NOTE, { title: 'typed text' });
    await queue.flush(NOTE);
    expect(queue.getStatus().state).toBe('error');

    await queue.flush(NOTE);

    expect(applyNotePatch).toHaveBeenCalledTimes(2);
    expect(applyNotePatch.mock.calls[1]?.[1]).toEqual({ title: 'typed text' });
    expect(queue.getStatus().state).toBe('saved');
    expect(queue.getStatus().errorMessage).toBeNull();
    expect(queue.hasPending(NOTE)).toBe(false);
  });

  it('lets a newer edit win over the patch that failed', async () => {
    applyNotePatch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(saved(3000));

    queue.schedule(NOTE, { title: 'old text' });
    await queue.flush(NOTE);
    // The user carries on typing after the failure.
    queue.schedule(NOTE, { title: 'new text' });
    await queue.flush(NOTE);

    expect(applyNotePatch.mock.calls[1]?.[1]).toEqual({ title: 'new text' });
  });

  it('does not spin retrying a permanently failing store', async () => {
    applyNotePatch.mockRejectedValue(new Error('always fails'));

    queue.schedule(NOTE, { title: 'text' });
    await queue.flush(NOTE);
    // No timer is re-armed by the failure, so nothing retries on its own.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(applyNotePatch).toHaveBeenCalledTimes(1);
    expect(queue.peekPending(NOTE)).toEqual({ title: 'text' });
  });

  it('passes the session base version to the repository', async () => {
    applyNotePatch.mockResolvedValue(saved(4000));

    queue.setBaseVersion(NOTE, 1234);
    queue.schedule(NOTE, { title: 'x' });
    await queue.flush(NOTE);

    expect(applyNotePatch).toHaveBeenCalledWith(NOTE, { title: 'x' }, { expectedUpdatedAt: 1234 });
    // A successful write advances the base version to what was stored.
    expect(queue.getBaseVersion(NOTE)).toBe(4000);
  });
});
