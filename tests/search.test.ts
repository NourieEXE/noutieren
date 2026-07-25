import { beforeEach, describe, expect, it } from 'vitest';
import { doc, resetDatabase } from './helpers';
import { createTab } from '../src/database/tabsRepository';
import { applyNotePatch, createNote } from '../src/database/notesRepository';
import { buildSnippet, runSearch } from '../src/services/workspaceService';
import type { NoteTab } from '../src/types';

let work: NoteTab;
let home: NoteTab;

beforeEach(async () => {
  await resetDatabase();
  work = await createTab({ title: 'Work', color: '#0ea5e9' });
  home = await createTab({ title: 'Home', color: '#22c55e' });

  await createNote({
    tabId: work.id,
    title: 'Sprint planning',
    content: doc('Discuss the roadmap and the release schedule.'),
  });
  await createNote({
    tabId: work.id,
    title: 'Meeting notes',
    content: doc('Nothing about roadmaps here, just coffee.'),
  });
  await createNote({
    tabId: home.id,
    title: 'Groceries',
    content: doc('Oat milk, bread, and a roadmap of the garden.'),
  });
});

describe('searching within the selected tab', () => {
  it('matches note text', async () => {
    const results = await runSearch({ query: 'release', scope: 'tab', tabId: work.id });
    expect(results.map((result) => result.note.title)).toEqual(['Sprint planning']);
  });

  it('matches note titles', async () => {
    const results = await runSearch({ query: 'meeting', scope: 'tab', tabId: work.id });
    expect(results.map((result) => result.note.title)).toEqual(['Meeting notes']);
    expect(results[0].matchedTitle).toBe(true);
  });

  it('ignores case', async () => {
    const upper = await runSearch({ query: 'ROADMAP', scope: 'tab', tabId: work.id });
    const lower = await runSearch({ query: 'roadmap', scope: 'tab', tabId: work.id });
    expect(upper.map((r) => r.note.id)).toEqual(lower.map((r) => r.note.id));
    expect(upper).toHaveLength(2);
  });

  it('does not look in other tabs', async () => {
    const results = await runSearch({ query: 'Oat milk', scope: 'tab', tabId: work.id });
    expect(results).toEqual([]);
  });
});

describe('searching across all tabs', () => {
  it('finds notes in every tab and attaches the owning tab', async () => {
    const results = await runSearch({ query: 'roadmap', scope: 'all', tabId: work.id });

    expect(results).toHaveLength(3);
    const groceries = results.find((result) => result.note.title === 'Groceries');
    expect(groceries?.tab?.title).toBe('Home');
    expect(groceries?.tab?.color).toBe('#22c55e');
  });

  it('orders title matches before body matches', async () => {
    await createNote({ tabId: home.id, title: 'Roadmap', content: doc('a title match') });
    const results = await runSearch({ query: 'roadmap', scope: 'all', tabId: home.id });
    expect(results[0].note.title).toBe('Roadmap');
    expect(results[0].matchedTitle).toBe(true);
  });

  it('orders equally-relevant results by most recently updated', async () => {
    const older = await createNote({ tabId: home.id, title: 'older', content: doc('needle') });
    const newer = await createNote({ tabId: home.id, title: 'newer', content: doc('needle') });
    await applyNotePatch(newer.id, { content: doc('needle again') });

    const results = await runSearch({ query: 'needle', scope: 'all', tabId: home.id });
    expect(results.map((result) => result.note.id)).toEqual([newer.id, older.id]);
  });
});

describe('empty and no-result searches', () => {
  it('returns nothing for a blank query', async () => {
    expect(await runSearch({ query: '', scope: 'all', tabId: work.id })).toEqual([]);
    expect(await runSearch({ query: '    ', scope: 'tab', tabId: work.id })).toEqual([]);
  });

  it('returns nothing when there is no match', async () => {
    expect(await runSearch({ query: 'xyzzy', scope: 'all', tabId: work.id })).toEqual([]);
  });

  it('handles a null tab selection', async () => {
    const results = await runSearch({ query: 'roadmap', scope: 'tab', tabId: null });
    expect(results).toEqual([]);
  });
});

describe('snippets', () => {
  it('centres the excerpt on the match', () => {
    const text = `${'before '.repeat(20)}NEEDLE${' after'.repeat(20)}`;
    const snippet = buildSnippet(text, 'needle');
    expect(snippet).toContain('NEEDLE');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(120);
  });

  it('collapses whitespace and copes with no match', () => {
    expect(buildSnippet('a\n\n  b', 'zzz')).toBe('a b');
    expect(buildSnippet('', 'x')).toBe('');
  });

  it('is included in search results', async () => {
    const results = await runSearch({ query: 'coffee', scope: 'tab', tabId: work.id });
    expect(results[0].snippet).toContain('coffee');
  });
});

describe('search scale', () => {
  it('stays correct with a few thousand notes', async () => {
    const bulk = await createTab({ title: 'Bulk' });
    for (let i = 0; i < 2000; i += 1) {
      await createNote({ tabId: bulk.id, title: `Note ${i}`, content: doc(`body ${i}`) });
    }

    const started = Date.now();
    const results = await runSearch({ query: 'body 1999', scope: 'all', tabId: bulk.id });
    const elapsed = Date.now() - started;

    expect(results.map((result) => result.note.title)).toEqual(['Note 1999']);
    // Generous bound: this is a correctness test that would also catch an
    // accidental full-document scan.
    expect(elapsed).toBeLessThan(4000);
  });
});
