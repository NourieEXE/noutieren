import { useRef, useState, type RefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useWorkspace } from '../hooks/workspaceContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { runSearch } from '../services/workspaceService';
import { previewText } from '../editor/document';
import { formatAbsoluteTime, formatRelativeTime } from '../utils/time';
import { withAlpha } from '../utils/colors';
import type { NoteMeta, SearchResult } from '../types';
import { Icon } from './Icons';

/** Row height must match `--note-row-height` in the stylesheet. */
const ROW_HEIGHT = 74;
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Notes list for the selected tab, with local search.
 *
 * Search is a substring scan over locally stored note titles and plain text.
 * Nothing is sent anywhere. Long lists are windowed so a tab with thousands of
 * notes still scrolls smoothly.
 */
export function NotesPanel({
  panelId,
  labelledBy,
  searchInputRef,
}: {
  panelId: string;
  labelledBy: string | undefined;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  const {
    notes,
    tabs,
    selectedTabId,
    selectedNoteId,
    selectNote,
    revealNote,
    actions,
    preferences,
    updatePreferences,
  } = useWorkspace();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const scope = preferences.searchAllTabs ? 'all' : 'tab';
  const searching = debouncedQuery.trim().length > 0;

  const results = useLiveQuery(
    () =>
      searching
        ? runSearch({ query: debouncedQuery, scope, tabId: selectedTabId })
        : Promise.resolve<SearchResult[]>([]),
    [debouncedQuery, scope, selectedTabId, searching],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const itemCount = searching ? (results?.length ?? 0) : notes.length;
  const window_ = useVirtualRows(listRef, itemCount, ROW_HEIGHT);

  return (
    <section
      className="notes-panel"
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={-1}
    >
      <header className="notes-panel__header">
        <div className="search">
          <span className="search__icon" aria-hidden="true">
            <Icon name="search" />
          </span>
          <input
            ref={searchInputRef}
            className="input search__input"
            type="search"
            value={query}
            placeholder="Search notes"
            aria-label="Search notes (Ctrl+K)"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query.length > 0) {
                event.stopPropagation();
                setQuery('');
              }
            }}
          />
        </div>

        <div className="notes-panel__actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={preferences.searchAllTabs}
              onChange={(event) => updatePreferences({ searchAllTabs: event.target.checked })}
            />
            <span>All tabs</span>
          </label>

          <button
            type="button"
            className="button button--primary button--compact"
            onClick={() => void actions.createNote()}
            disabled={!selectedTabId}
            title="New note (Ctrl+N)"
          >
            <Icon name="plus" />
            New note
          </button>
        </div>
      </header>

      <div className="notes-panel__list" ref={listRef} role="list" aria-label="Notes">
        {itemCount === 0 ? (
          <EmptyNotesState searching={searching} query={debouncedQuery} scope={scope} />
        ) : (
          <>
            <div style={{ height: window_.paddingTop }} aria-hidden="true" />
            {searching
              ? (results ?? [])
                  .slice(window_.startIndex, window_.endIndex)
                  .map((result) => (
                    <NoteRow
                      key={result.note.id}
                      note={result.note}
                      selected={result.note.id === selectedNoteId}
                      snippet={result.snippet}
                      tabLabel={scope === 'all' ? result.tab?.title : undefined}
                      tabColor={result.tab?.color}
                      onSelect={() => revealNote(result.note.tabId, result.note.id)}
                    />
                  ))
              : notes
                  .slice(window_.startIndex, window_.endIndex)
                  .map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      selected={note.id === selectedNoteId}
                      snippet={previewText(note.plainText)}
                      onSelect={() => selectNote(note.id)}
                    />
                  ))}
            <div style={{ height: window_.paddingBottom }} aria-hidden="true" />
          </>
        )}
      </div>

      <footer className="notes-panel__footer">
        {searching
          ? `${itemCount} ${itemCount === 1 ? 'result' : 'results'}${
              scope === 'all' ? ` across ${tabs.length} tabs` : ' in this tab'
            }`
          : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
      </footer>
    </section>
  );
}

function NoteRow({
  note,
  selected,
  snippet,
  tabLabel,
  tabColor,
  onSelect,
}: {
  note: NoteMeta;
  selected: boolean;
  snippet: string;
  tabLabel?: string | undefined;
  tabColor?: string | undefined;
  onSelect: () => void;
}) {
  return (
    <div role="listitem" className="note-row__wrapper">
      <button
        type="button"
        className={`note-row${selected ? ' note-row--selected' : ''}`}
        style={{ ['--note-color' as string]: note.color }}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className="note-row__strip" aria-hidden="true" />
        <span className="note-row__body">
          <span className="note-row__title">{note.title}</span>
          <span className="note-row__preview">
            {snippet.length > 0 ? snippet : <span className="note-row__empty">Empty note</span>}
          </span>
        </span>
        <span className="note-row__meta">
          {tabLabel ? (
            <span className="chip" style={{ background: withAlpha(tabColor ?? '#64748b', 0.18) }}>
              <span
                className="chip__dot"
                style={{ background: tabColor ?? '#64748b' }}
                aria-hidden="true"
              />
              {tabLabel}
            </span>
          ) : null}
          <time
            dateTime={new Date(note.updatedAt).toISOString()}
            title={formatAbsoluteTime(note.updatedAt)}
          >
            {formatRelativeTime(note.updatedAt)}
          </time>
        </span>
      </button>
    </div>
  );
}

function EmptyNotesState({
  searching,
  query,
  scope,
}: {
  searching: boolean;
  query: string;
  scope: 'tab' | 'all';
}) {
  if (searching) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No notes match “{query.trim()}”.</p>
        <p className="empty-state__hint">
          {scope === 'tab'
            ? 'Try “All tabs” to search everywhere.'
            : 'Try a shorter word — search matches note titles and text.'}
        </p>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <p className="empty-state__title">This tab has no notes yet.</p>
      <p className="empty-state__hint">
        Choose <strong>New note</strong> above, or press <kbd>Ctrl</kbd>+<kbd>N</kbd>.
      </p>
    </div>
  );
}
