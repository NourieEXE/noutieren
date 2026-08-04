/**
 * Deciding what "Pin to URL" hides, kept separate from React so the rules can
 * be tested directly.
 *
 * One principle runs through all of it: **a pin hides, it never deletes, and it
 * must always be escapable.** Notes are the kind of thing people trust with
 * work they cannot reproduce, so a feature that makes content disappear has to
 * be impossible to mistake for data loss. Hence `hiddenTabCount` and
 * `hiddenNoteCount`, which the UI is expected to surface whenever they are
 * non-zero, and the `showHidden` override that reveals everything at once.
 */

import type { NoteMeta, NoteTab } from '../types';
import { matchesAnyPattern } from '../utils/matchPattern';

export interface PinContext {
  /** The active tab's URL, or `null` when unknown or not permitted. */
  activeUrl: string | null;
  /** True when the `tabs` permission is held. Pins are inert without it. */
  granted: boolean;
  /** The user's "show hidden" override. */
  showHidden: boolean;
  /**
   * True where there is no meaningful "page next to the sidebar" — the
   * full-page view, which is itself a browser tab. Applying pins there would
   * hide every pinned item at once and read as data loss, so pins go inert
   * instead. This doubles as a guaranteed way back to hidden content.
   */
  inert: boolean;
}

/** Whether pins are being enforced at all. */
export function pinsActive(context: PinContext): boolean {
  return context.granted && !context.inert && !context.showHidden;
}

/** Whether an item carries a pin, regardless of whether it currently matches. */
export function isPinned(item: { urlPatterns?: readonly string[] }): boolean {
  return (item.urlPatterns?.length ?? 0) > 0;
}

/**
 * Whether one item should be shown.
 *
 * An unpinned item is always visible; that is checked before anything else, so
 * the common case never parses a pattern.
 */
export function isVisible(item: { urlPatterns?: readonly string[] }, context: PinContext): boolean {
  if (!isPinned(item)) return true;
  if (!pinsActive(context)) return true;
  return matchesAnyPattern(item.urlPatterns ?? [], context.activeUrl);
}

export interface VisibleWorkspace {
  tabs: NoteTab[];
  notes: NoteMeta[];
  /** How many tabs a pin is currently hiding. */
  hiddenTabCount: number;
  /** How many notes in the *selected* tab a pin is currently hiding. */
  hiddenNoteCount: number;
}

/**
 * Applies pins to the tab strip and the open tab's notes.
 *
 * A pinned item is hidden as soon as it stops matching, **including the one
 * currently selected**. An earlier version kept the selection on screen to
 * avoid pulling it away mid-read, and that was wrong: you pin the note you are
 * looking at, so it stayed selected, so it never hid, so the feature did
 * nothing. Whatever is being edited is autosaved, and the stored selection is
 * left alone — see `effectiveNoteId` in the provider — so nothing is lost and
 * returning to the page brings it straight back.
 *
 * The only exemptions are `keepTabId` and `keepNoteId`, which name one item
 * each that has been *explicitly* asked for and must therefore be shown even
 * though a pin covers it. In practice that is a search result: search looks
 * past pins on purpose, so opening one has to actually open it. Both are still
 * counted as hidden, so the indicator explains why they look different.
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
 * Picks the note to show when a pin hides the selected one.
 *
 * Mirrors `resolveTabAfterPinChange`: returns `null` for "keep the current
 * selection", so the stored choice is never overwritten and comes back when the
 * page it is pinned to is open again.
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

/**
 * Picks the tab to fall back to when the selected one is hidden by a pin.
 *
 * Returns `null` to mean "keep the current selection". That is the answer
 * whenever a move would be unhelpful — nothing is hidden, or every tab is
 * hidden and switching would only trade one empty view for another.
 */
export function resolveTabAfterPinChange(
  tabs: readonly NoteTab[],
  selectedTabId: string | null,
  context: PinContext,
): string | null {
  if (!pinsActive(context)) return null;
  if (!selectedTabId) return null;

  const selected = tabs.find((tab) => tab.id === selectedTabId);
  if (!selected || isVisible(selected, context)) return null;

  // Prefer a tab pinned to this page over an unpinned one: if the user pinned a
  // tab to the page they just opened, showing that tab is the entire point of
  // the feature.
  const matching = tabs.find((tab) => isPinned(tab) && isVisible(tab, context));
  if (matching) return matching.id;

  const anyVisible = tabs.find((tab) => isVisible(tab, context));
  return anyVisible ? anyVisible.id : null;
}
