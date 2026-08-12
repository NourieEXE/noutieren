/**
 * What "Pin to URL" hides. Kept out of React so the rules can be tested
 * directly.
 *
 * A pin hides, it never deletes, and it must always be escapable. Hence the
 * hidden counts, which the UI surfaces whenever they are non-zero, and the
 * `showHidden` override.
 */

import type { NoteMeta, NoteTab } from '../types';
import { matchesAnyPattern } from '../utils/matchPattern';

export interface PinContext {
  activeUrl: string | null;
  granted: boolean;
  showHidden: boolean;
  /**
   * True where there is no page beside the view. The full-page tab is itself a
   * browser tab, so applying pins there would hide everything at once.
   */
  inert: boolean;
}

export function pinsActive(context: PinContext): boolean {
  return context.granted && !context.inert && !context.showHidden;
}

export function isPinned(item: { urlPatterns?: readonly string[] }): boolean {
  return (item.urlPatterns?.length ?? 0) > 0;
}

export function isVisible(item: { urlPatterns?: readonly string[] }, context: PinContext): boolean {
  if (!isPinned(item)) return true;
  if (!pinsActive(context)) return true;
  return matchesAnyPattern(item.urlPatterns ?? [], context.activeUrl);
}

export interface VisibleWorkspace {
  tabs: NoteTab[];
  notes: NoteMeta[];
  hiddenTabCount: number;
  hiddenNoteCount: number;
}

/**
 * Applies pins to the tab strip and the open tab's notes.
 *
 * `keepTabId` and `keepNoteId` name one item each that was explicitly asked
 * for and must be shown even though a pin covers it. In practice that is a
 * search result, since search looks past pins so notes stay findable. The
 * selection itself is filtered like anything else, which is what makes a
 * pinned note disappear when you navigate away.
 */
export function selectVisible(
  tabs: readonly NoteTab[],
  notes: readonly NoteMeta[],
  keepTabId: string | null,
  keepNoteId: string | null,
  context: PinContext,
): VisibleWorkspace {
  const visibleTabs: NoteTab[] = [];
  let hiddenTabCount = 0;

  for (const tab of tabs) {
    if (isVisible(tab, context)) {
      visibleTabs.push(tab);
    } else {
      hiddenTabCount += 1;
      if (tab.id === keepTabId) visibleTabs.push(tab);
    }
  }

  const visibleNotes: NoteMeta[] = [];
  let hiddenNoteCount = 0;

  for (const note of notes) {
    if (isVisible(note, context)) {
      visibleNotes.push(note);
    } else {
      hiddenNoteCount += 1;
      if (note.id === keepNoteId) visibleNotes.push(note);
    }
  }

  return { tabs: visibleTabs, notes: visibleNotes, hiddenTabCount, hiddenNoteCount };
}

/**
 * The note to show when a pin hides the selected one. `null` means keep the
 * current selection, so the stored choice is never overwritten.
 */
export function resolveNoteAfterPinChange(
  notes: readonly NoteMeta[],
  selectedNoteId: string | null,
  context: PinContext,
): string | null {
  if (!pinsActive(context)) return null;
  if (!selectedNoteId) return null;

  const selected = notes.find((note) => note.id === selectedNoteId);
  if (!selected || isVisible(selected, context)) return null;

  const matching = notes.find((note) => isPinned(note) && isVisible(note, context));
  if (matching) return matching.id;

  const anyVisible = notes.find((note) => isVisible(note, context));
  return anyVisible ? anyVisible.id : null;
}

/** The same for tabs. Prefers a tab pinned to this page over an unpinned one. */
export function resolveTabAfterPinChange(
  tabs: readonly NoteTab[],
  selectedTabId: string | null,
  context: PinContext,
): string | null {
  if (!pinsActive(context)) return null;
  if (!selectedTabId) return null;

  const selected = tabs.find((tab) => tab.id === selectedTabId);
  if (!selected || isVisible(selected, context)) return null;

  const matching = tabs.find((tab) => isPinned(tab) && isVisible(tab, context));
  if (matching) return matching.id;

  const anyVisible = tabs.find((tab) => isVisible(tab, context));
  return anyVisible ? anyVisible.id : null;
}
