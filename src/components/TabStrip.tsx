import { useRef, useState } from 'react';
import { useWorkspace } from '../hooks/workspaceContext';
import { readableTextColor, withAlpha } from '../utils/colors';
import { Icon } from './Icons';
import { TabSettingsDialog } from './TabSettingsDialog';

/**
 * Color-labeled tab navigation.
 *
 * Uses the ARIA tab pattern with manual activation: arrows and Home/End move
 * focus, Enter or Space selects. The selected tab is filled with its own color
 * using a foreground picked for contrast, and every tab additionally shows a
 * color dot and a note count, so state never depends on color alone.
 *
 * The strip scrolls horizontally when tabs overflow; the page never does.
 */
export function TabStrip({ notesPanelId }: { notesPanelId: string | undefined }) {
  const { tabs, noteCounts, selectedTabId, selectTab, actions } = useWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedTabId);
  const selectedTab = selectedIndex >= 0 ? tabs[selectedIndex] : undefined;

  const focusTabAt = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), tabs.length - 1);
    const target = tabs[clamped];
    if (!target) return;
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(target.id)}"]`)
      ?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusTabAt(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusTabAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTabAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusTabAt(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="tabstrip">
      <div
        className="tabstrip__list"
        role="tablist"
        aria-label="Note tabs"
        aria-orientation="horizontal"
        ref={listRef}
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === selectedTabId;
          const count = noteCounts[tab.id] ?? 0;
          const style = selected
            ? { background: tab.color, color: readableTextColor(tab.color), borderColor: tab.color }
            : { background: withAlpha(tab.color, 0.12), borderColor: withAlpha(tab.color, 0.45) };

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              data-tab-id={tab.id}
              className={`tab${selected ? ' tab--selected' : ''}`}
              style={style}
              aria-selected={selected}
              aria-controls={notesPanelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onDoubleClick={() => {
                if (selected) setSettingsOpen(true);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span
                className="tab__dot"
                style={{ background: selected ? readableTextColor(tab.color) : tab.color }}
                aria-hidden="true"
              />
              <span className="tab__title">{tab.title}</span>
              <span className="tab__count" aria-hidden="true">
                {count}
              </span>
              <span className="visually-hidden">
                {count} {count === 1 ? 'note' : 'notes'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="tabstrip__controls">
        <button
          type="button"
          className="icon-button"
          onClick={() => void actions.createTab()}
          aria-label="New tab (Ctrl+Shift+N)"
          title="New tab (Ctrl+Shift+N)"
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          disabled={!selectedTab}
          aria-label={selectedTab ? `Settings for tab "${selectedTab.title}"` : 'Tab settings'}
          title="Tab settings"
        >
          <Icon name="gear" />
        </button>
      </div>

      {selectedTab ? (
        <TabSettingsDialog
          tab={selectedTab}
          noteCount={noteCounts[selectedTab.id] ?? 0}
          canMoveLeft={selectedIndex > 0}
          canMoveRight={selectedIndex < tabs.length - 1}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onRename={(title) => void actions.renameTab(selectedTab.id, title)}
          onRecolor={(color) => void actions.recolorTab(selectedTab.id, color)}
          onMove={(delta) => void actions.moveTab(selectedTab.id, delta)}
          onDelete={() => void actions.deleteTab(selectedTab.id)}
        />
      ) : null}
    </div>
  );
}
