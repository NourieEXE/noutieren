# Changelog

All notable changes to Noutieren. Dates are the build date; versions follow
[semantic versioning](https://semver.org/).

## Unreleased

### Added

- **What's new.** _Settings → What's new_ opens a page with plain notes for every version,
  newest first, from `src/releaseNotes.ts`. After an update, a one-line notice at the top of the
  sidebar or popup links to it until dismissed; a fresh install shows nothing. The background
  records the version updated from on `runtime.onInstalled`. A test fails if `CHANGELOG.md` and
  the release notes disagree, or if the version being built has no notes.
- **Reminders repeat until seen.** A reminder that has gone off stays until its note is opened,
  its notification is clicked or dismissed, or it is removed. Until then it goes off again every
  2, 5, 10 or 15 minutes (5 by default, set under _If you miss it_ in the reminder dialog) for up
  to an hour.
- **A count on the toolbar button** of reminders waiting to be seen, and a red bell on their
  notes in the list. Both work without the notifications permission.

### Changed

- A reminder is no longer cleared when it is shown. Notes carry `reminderShownAt` alongside
  `remindAt`; both are cleared when the reminder is seen. No schema change.

### Security

- **Updated Tiptap to 3.32.0 and prosemirror-view to 1.42.6**, past an XSS in ProseMirror's paste
  handling ([GHSA-c8x8-7fp4-3x9w](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w)), a
  `__proto__` attribute injection in Tiptap
  ([GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh)) and a Markdown ReDoS
  ([GHSA-j95f-988m-3j2f](https://github.com/advisories/GHSA-j95f-988m-3j2f)). The extension
  page's CSP already blocked inline script, so the XSS had no way to run, but the fix is the fix.
- **URL pins no longer compile to a regular expression.** Each `*` became `.*`, and a pattern
  with several of them, typed or imported from a backup, could take minutes to test against an
  ordinary address, freezing the sidebar or popup on every page change. A plain wildcard
  matcher replaces it; patterns match exactly as before.
- **Reminder notifications no longer include the note's text**, only its title. Notifications
  show on lock screens, stay in the system's notification history, and appear in screen shares.
- **Hardening**, none of it exploitable before as far as could be found:
  - The extension pages' CSP starts from `default-src 'none'` and sets `object-src 'none'`, so a
    kind of resource nobody allowed is refused. `verify-build.mjs` requires both.
  - Chrome's service worker only accepts handed-off writes from this extension's own pages. The
    browser already guarantees that for `onMessage`; the worker now checks too.
  - Imported documents nested more than 100 levels deep are rejected with a message, instead of
    overflowing the stack (5,000 levels did) or reaching the editor.
  - The repository link on the What's new page opens in a new tab without a referrer, so it does
    not tell GitHub the visitor has Noutieren installed.
  - A test pins down that the live editor drops `javascript:`, `data:` and `vbscript:` links
    from pasted HTML and refuses them in the link command.

### Fixed

- The app's layout was a grid with one row per child, so any line shown above the tab strip,
  such as the full-page permission banner, shifted the rows and stretched the tab strip. It is a
  column now.

## 1.4.0 - 2026-09-26

### Added

- **Recently deleted.** Deleting a note, or a tab with notes in it, moves the notes to
  _Settings → Recently deleted_ for 30 days instead of erasing them. Restore puts a note back
  where it was, and brings its tab back if that was deleted too. _Delete forever_ and _Empty_
  are there for when you mean it. Reset clears it; exports leave it out.

- **Reminders.** _Note actions → Remind me…_ sets a time, from quick picks or any date and time.
  When it is due the browser shows a notification, even with Noutieren closed, and clicking it
  opens the note. Reminders missed while the browser was closed show at the next start.
- **`notifications`, as an optional permission**, asked for when you set the first reminder.
  On Chrome the popup hands the prompt to the full-page view, as it does for pins.

### Changed

- **`alarms` is a required permission.** It shows no prompt, at install or on update, and
  Firefox does not allow it as optional. `verify-build.mjs` accepts it and `notifications`, and
  nothing else.
- **Database schema versions 4 and 5.** v4 adds the `trash` table, v5 an index on `remindAt`.
  No upgrade steps.
- **Backups carry reminders** that are still ahead, at format version 1, so 1.3.0 can read them
  and ignores the field.
- The Firefox background page now bundles the database code, to fire reminders.

### Fixed

- Moving a tab or note steps over anything a URL pin is hiding. It used to swap with the hidden
  neighbour, so nothing on screen changed, and a tab with only hidden tabs to its right could
  still be moved right.
- A note pin change still waiting to be written when the Chrome popup closed was dropped by the
  service worker. It is now written like any other change.
- Messages no longer mention Firefox or the sidebar, which was wrong in the Chrome popup: the
  backup reminder, two storage errors and the shortcut note in the help dialog.

## 1.3.0 - 2026-08-04

### Added

- **Pin to URL.** A tab or an individual note can be set to appear only while a particular page
  is open. Patterns use WebExtension match-pattern syntax:

  | Pattern                                       | Matches                                     |
  | --------------------------------------------- | ------------------------------------------- |
  | `https://www.youtube.com/watch?v=eDQtUwad5vg` | that one video and nothing else             |
  | `https://www.youtube.com/`                    | the YouTube home page only                  |
  | `https://*.youtube.com/*`                     | all of YouTube, including `music.` and `m.` |
  | `youtube.com`                                 | shorthand for `*://youtube.com/`            |

  `*.youtube.com` covers the apex domain as well as subdomains, and cannot be satisfied by a
  lookalike such as `notyoutube.com`. A wildcard is never added for you: type the `*` yourself
  or tick _Also match everything under this address_, which prints the pattern it will save.

- **The `tabs` permission, as an optional permission.** Not requested at install or on update.
  Saving a pin does not prompt either, since a pin is inert but valid without the permission,
  so storing one costs nothing while refusing would discard what you typed. Once a pin exists
  the editor offers **Enable Pin to URL**, which is the only thing that raises the prompt.
  Declining leaves the pins saved and inert, and revoking later leaves your notes intact. See
  [PRIVACY.md](PRIVACY.md#pin-to-url-and-the-tabs-permission).

- **A "show hidden" toggle in the tab strip**, which appears whenever a pin is hiding something
  and reveals all of it in one click. A pin hides, it never deletes.

- **A Chrome build**, published as
  [Noutieren on the Chrome Web Store](https://chromewebstore.google.com/detail/noutieren/fehabengonhjmgghempjpcgfkggppknf)
  and documented in [`chrome_version/`](chrome_version/README.md). The toolbar button opens an
  800x600 popup, since Chrome has no sidebar API, and the full-page tab works as it does on
  Firefox.
- **`npm run verify:chrome`**, which loads the built extension into a headless Chromium under a
  throwaway profile and drives it over the DevTools protocol: that Chrome accepts the manifest
  and the strict CSP, that the popup renders at the size it declares, that text typed a moment
  before the popup is destroyed survives, and that pins stay inert without the permission.
  Twenty-eight checks on Chromium 151.
- **Teardown handoff for autosave.** Chrome destroys a popup's document the moment it loses
  focus, taking any open IndexedDB transaction with it, so a write started there is unreliable.
  The Chrome build hands pending patches to its service worker, which outlives the popup.
  Firefox is unchanged and still flushes in place.

### Changed

- **Database schema version 3.** Additive: tabs and notes may carry a `urlPatterns` field. No
  upgrade step, since a row without the field is already a correct unpinned row.
- **Backups carry pins**, at format version 1 as before, so 1.2.0 can still read a 1.3.0 backup
  and simply ignores them.
- `scripts/verify-build.mjs` checks required and optional permissions separately. The required
  list is still exactly `storage` and `unlimitedStorage`, and moving `tabs` into it fails the
  build.
- `chrome_version/` holds only what Chrome needs differently: a manifest, two HTML entries, a
  service worker and two Vite configs. There is no second copy of the application, and
  `npm run check` builds both targets so shared changes cannot break Chrome silently.
- `getBrowserApi()` falls back to Chrome's `chrome` namespace, testing `runtime.id` to avoid
  mistaking the unrelated `chrome` object on ordinary web pages for the extension API.
- `scripts/verify-build.mjs` takes `--target=firefox|chrome`. The self-containment audit is
  identical for both.

### Chrome and the permission prompt

Chrome closes the toolbar popup as soon as it loses focus, which is what a permission dialog
does, so the request cannot be answered there. **Enable Pin to URL** opens the full-page view,
an ordinary tab, carrying `?grant=pins` so that tab leads with the request instead of arriving
on the editor. Firefox's sidebar stays open and prompts in place. The surface test is
`canPromptForPermission()`, so neither build guesses.

### Fixed

- **A refused request for persistent storage is no longer reported as an error.** Chrome
  declines `navigator.storage.persist()` for extension origins even with `unlimitedStorage`
  (measured on Chromium 150: `persist()` returns false while the quota is lifted to ~32 GB), so
  every launch logged an error claiming data "may be evicted", which is misleading about the
  permission that actually protects it.
- **Startup notices no longer appear under "Errors" in `chrome://extensions`.** That panel
  collects `console.warn` as well as `console.error`, so the line above was listed there on
  every launch, once per context. `logWarning` now logs at `debug`, which the panel does not
  collect and DevTools still shows under Verbose. `verify:chrome` asserts nothing is logged at
  `warn` level.

## 1.2.0 - 2026-07-25

Prepared for a listed addons.mozilla.org submission, where people arrive without having read
any documentation. **Since approved and published** as
[Noutieren (Notes)](https://addons.mozilla.org/en-US/firefox/addon/noutieren-notes/).

### Added

- **Eviction-exempt storage.** `navigator.storage.persist()` is requested at startup, so notes
  are not discarded when the disk comes under pressure. `unlimitedStorage` raises the quota
  ceiling, which is a separate question from eviction; this settles it explicitly. Failure is
  logged and never fatal.
- **Backup staleness reminder.** If a backup has not been taken for 21 days, a dismissible
  prompt offers to export one. It appears at most once per session, never on a workspace
  holding only the seeded note, and is measured from the workspace's age, so a new install
  stays quiet for its first few weeks.
- **Backup age in the settings menu**, replacing the static "Backup" heading with
  "Backed up 9 days ago" or "No backup exported yet".
- `PRIVACY.md` and `BUILDING.md`, the latter documenting a build that reproduces the published
  package byte for byte.

### Changed

- Exporting from the menu and from the reminder now share one code path, so a
  reminder-prompted export also counts as a backup.

## 1.1.0 - 2026-07-25

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
  `tabs` permission, which this extension did not request, and without it the filter can be
  ignored, returning arbitrary tabs. It now always opens a new tab, which needs no permission.

## 1.0.0 - 2026-07-25

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
