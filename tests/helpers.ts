import type { JSONContent } from '../src/types';
import { getDatabase } from '../src/database/db';

/** Empties every table, so each test starts from a known state. */
export async function resetDatabase(): Promise<void> {
  const db = getDatabase();
  if (!db.isOpen()) await db.open();
  await db.transaction('rw', db.tabs, db.notes, db.contents, db.meta, async () => {
    await db.contents.clear();
    await db.notes.clear();
    await db.tabs.clear();
    await db.meta.clear();
  });
}

/** A simple document containing one paragraph of `text`. */
export function doc(text: string): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

/** Waits for pending promise jobs to settle (no timers involved). */
export async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
