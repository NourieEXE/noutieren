import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './helpers';
import { createTab, getTab, updateTab } from '../src/database/tabsRepository';
import { applyNotePatch, createNote, getNote } from '../src/database/notesRepository';

beforeEach(async () => {
  await resetDatabase();
});

describe('storing a tab pin', () => {
  it('normalises patterns on the way in', async () => {
    const tab = await createTab({ title: 'Video', urlPatterns: ['youtube.com/*'] });
    expect(tab.urlPatterns).toEqual(['*://youtube.com/*']);
    expect((await getTab(tab.id))?.urlPatterns).toEqual(['*://youtube.com/*']);
  });

  it('leaves an unpinned tab without the field at all', async () => {
    const tab = await createTab({ title: 'Plain' });
    expect(tab.urlPatterns).toBeUndefined();
    expect('urlPatterns' in (await getTab(tab.id))!).toBe(false);
  });

  it('drops entries it cannot parse instead of failing the write', async () => {
    const tab = await createTab({
      title: 'Mixed',
      urlPatterns: ['https://example.com/*', 'javascript:alert(1)'],
    });
    expect(tab.urlPatterns).toEqual(['https://example.com/*']);
  });

  it('updates an existing pin', async () => {
    const tab = await createTab({ title: 'Video', urlPatterns: ['youtube.com/*'] });
    const updated = await updateTab(tab.id, { urlPatterns: ['https://vimeo.com/*'] });
    expect(updated?.urlPatterns).toEqual(['https://vimeo.com/*']);
  });

  it('removes the field when the pin is cleared, rather than storing an empty array', async () => {
    const tab = await createTab({ title: 'Video', urlPatterns: ['youtube.com/*'] });
    const cleared = await updateTab(tab.id, { urlPatterns: [] });
    expect(cleared?.urlPatterns).toBeUndefined();
    expect('urlPatterns' in (await getTab(tab.id))!).toBe(false);
  });

  it('leaves the pin untouched when the patch does not mention it', async () => {
    const tab = await createTab({ title: 'Video', urlPatterns: ['youtube.com/*'] });
    const renamed = await updateTab(tab.id, { title: 'Renamed' });
    expect(renamed?.title).toBe('Renamed');
    expect(renamed?.urlPatterns).toEqual(['*://youtube.com/*']);
  });
});

describe('storing a note pin', () => {
  it('round-trips through the note patch path', async () => {
    const tab = await createTab({ title: 'General' });
    const note = await createNote({ tabId: tab.id });

    await applyNotePatch(note.id, { urlPatterns: ['https://*.youtube.com/*'] });
    expect((await getNote(note.id))?.urlPatterns).toEqual(['https://*.youtube.com/*']);
  });

  it('clears the pin with an empty list', async () => {
    const tab = await createTab({ title: 'General' });
    const note = await createNote({ tabId: tab.id });

    await applyNotePatch(note.id, { urlPatterns: ['youtube.com/*'] });
    await applyNotePatch(note.id, { urlPatterns: [] });
    expect((await getNote(note.id))?.urlPatterns).toBeUndefined();
  });

  it('does not disturb the pin when only the title changes', async () => {
    const tab = await createTab({ title: 'General' });
    const note = await createNote({ tabId: tab.id });

    await applyNotePatch(note.id, { urlPatterns: ['youtube.com/*'] });
    await applyNotePatch(note.id, { title: 'Renamed' });

    const stored = await getNote(note.id);
    expect(stored?.title).toBe('Renamed');
    expect(stored?.urlPatterns).toEqual(['*://youtube.com/*']);
  });
});
