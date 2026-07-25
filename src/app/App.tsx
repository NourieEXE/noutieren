import { useId, useRef, useState } from 'react';
import { useWorkspace } from '../hooks/workspaceContext';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { detectViewMode, openFullPageEditor } from '../services/webext';
import { TabStrip } from '../components/TabStrip';
import { NotesPanel } from '../components/NotesPanel';
import { NoteEditorPane } from '../components/NoteEditorPane';
import { SettingsMenu } from '../components/SettingsMenu';
import { HelpDialog } from '../components/HelpDialog';
import { Icon } from '../components/Icons';

/**
 * Application shell.
 *
 * The same component tree serves the sidebar and the full-page tab; the layout
 * is chosen by the width of the workspace element (a CSS container query), not
 * by which surface it is running in, so a narrow window behaves like the
 * sidebar and a wide sidebar behaves like the page.
 */
export function App() {
  const { preferences, updatePreferences, actions, flushSaves, loading, selectedTab } =
    useWorkspace();
  const [helpOpen, setHelpOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notesPanelId = useId();
  const viewMode = detectViewMode();
  const collapsed = preferences.notesPanelCollapsed;

  useTheme(preferences.theme);

  useKeyboardShortcuts({
    onNewNote: () => void actions.createNote(),
    onNewTab: () => void actions.createTab(),
    onFocusSearch: () => {
      if (collapsed) updatePreferences({ notesPanelCollapsed: false });
      // Runs after the panel is mounted again. Focus first: selecting text
      // alone does not move focus.
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    },
    onFlushSaves: () => void flushSaves(),
  });

  return (
    <div className="app" data-view={viewMode}>
      <header className="app__bar">
        <button
          type="button"
          className="icon-button"
          aria-pressed={collapsed}
          onClick={() => updatePreferences({ notesPanelCollapsed: !collapsed })}
          aria-label={collapsed ? 'Show the notes list' : 'Hide the notes list'}
          title={collapsed ? 'Show notes list' : 'Hide notes list'}
        >
          <Icon name={collapsed ? 'panelExpand' : 'panelCollapse'} />
        </button>

        <h1 className="app__title">Noutieren</h1>

        {viewMode === 'sidebar' ? (
          <button
            type="button"
            className="button button--compact"
            onClick={() => void openFullPageEditor()}
            title="Open the same notes in a full browser tab"
          >
            <Icon name="externalLink" />
            <span className="app__bar-label">Full page</span>
          </button>
        ) : null}

        <button
          type="button"
          className="icon-button"
          onClick={() => setHelpOpen(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
        >
          <Icon name="help" />
        </button>

        <SettingsMenu />
      </header>

      <TabStrip notesPanelId={collapsed ? undefined : notesPanelId} />

      {loading ? (
        <p className="app__loading">Loading your notes…</p>
      ) : (
        <main className={`workspace${collapsed ? ' workspace--collapsed' : ''}`}>
          {collapsed ? null : (
            <NotesPanel
              panelId={notesPanelId}
              labelledBy={selectedTab ? `tab-${selectedTab.id}` : undefined}
              searchInputRef={searchInputRef}
            />
          )}
          <NoteEditorPane />
        </main>
      )}

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
