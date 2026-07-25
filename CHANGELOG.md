# Changelog

All notable changes to Noutieren. Dates are the build date; versions follow
[semantic versioning](https://semver.org/).

## 1.2.0 — 2026-07-25

Prepared for a listed addons.mozilla.org submission, where people arrive without having read
any documentation.

### Added

- **Eviction-exempt storage.** `navigator.storage.persist()` is requested at startup, so notes
  are not discarded when the disk comes under pressure. `unlimitedStorage` raises the quota
  ceiling, which is a separate question from eviction; this settles it explicitly. Failure is
  logged and never fatal.
- **Backup staleness reminder.** If a backup has not been taken for 21 days, a dismissible
  prompt offers to export one. It appears at most once per session, never on a workspace
  holding only the seeded note, and is measured from the workspace's age — so a new install
  stays quiet for its first few weeks.
- **Backup age in the settings menu**, replacing the static "Backup" heading with
  "Backed up 9 days ago" or "No backup exported yet".
- `PRIVACY.md` and `BUILDING.md`, the latter documenting a build that reproduces the published
  package byte for byte.

### Changed

- Exporting from the menu and from the reminder now share one code path, so a
  reminder-prompted export also counts as a backup.

## 1.1.0 — 2026-07-25

### Changed

- **Renamed** from _ColorNote Tabs_ to _Noutieren_. The extension ID and IndexedDB database
  name deliberately keep their original spelling: they are storage identities, and changing
  them would orphan every existing note. See _Renaming and identifiers_ in the README.
- **No runtime stylesheet injection.** The editor is created with `injectCSS: false` and
  ProseMirror's base rules ship as static CSS, so the extension never writes markup into the
  document while running.
- **Minimum Firefox raised to 142**, which is when
  `browser_specific_settings.gecko.data_collection_permissions` became available on Android as
  well as desktop.

### Fixed

- **Opening the full-page editor could activate an unrelated tab.** It previously used
  `tabs.query({ url })` to reuse an existing editor tab, but filtering by URL requires the
  `tabs` permission, which this extension does not request — and without it the filter can be
  ignored, returning arbitrary tabs. It now always opens a new tab, which needs no permission.

## 1.0.0 — 2026-07-25

Initial release.

- Color-labeled tabs, unlimited, renameable, recolourable and reorderable, each showing its
  note count
- Unlimited notes per tab, each with its own title and colour, movable between tabs,
  duplicable and reorderable, with undo for deletion
- Rich-text editing via Tiptap/ProseMirror: bold, italic, underline, strikethrough, headings
  1–3, bulleted, numbered and check lists, block quotes, inline code, code blocks, links,
  undo/redo and clear formatting
- Debounced autosave with per-note write isolation, flush on note switch, blur, tab hide and
  unload, and conflict detection between two open views
- Local search across the current tab or every tab
- JSON export and import, with replace or merge, allowlist sanitizing of imported documents,
  and a safety backup before a replace
- Light, dark and system themes; keyboard navigation throughout; usable from a 320 px sidebar
  to a full window
- No network requests, no accounts, no telemetry; two permissions (`storage`,
  `unlimitedStorage`)
