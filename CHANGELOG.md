# Changelog

All notable changes to Noutieren. Dates are the build date; versions follow
[semantic versioning](https://semver.org/).

## Unreleased

## 1.3.0 — 2026-08-04

### Added

- **Pin to URL.** A tab or an individual note can be told to appear only while a particular page
  is open — notes that surface on YouTube and stay out of the way everywhere else. Patterns use
  the standard WebExtension match-pattern syntax, so the distinctions you would expect are the
  ones you get:

  | Pattern                                       | Matches                                     |
  | --------------------------------------------- | ------------------------------------------- |
  | `https://www.youtube.com/watch?v=eDQtUwad5vg` | that one video, and nothing else            |
  | `https://www.youtube.com/`                    | the YouTube home page only                  |
  | `https://*.youtube.com/*`                     | all of YouTube, including `music.` and `m.` |
  | `youtube.com`                                 | shorthand, read as `*://youtube.com/`       |

  `*.youtube.com` covers the apex domain as well as subdomains, and cannot be satisfied by a
  lookalike such as `notyoutube.com`.

  **A wildcard is never added for you.** What you type is what is stored, and widening is an
  explicit choice: type the `*` yourself, or tick _Also match everything under this address_,
  which prints the exact pattern it will save before you add it.

- **The `tabs` permission, as an _optional_ permission.** Reading which page you are on is what
  makes pinning possible, and it is the first thing Noutieren has ever been able to see outside
  its own storage — so it is not requested at install or on update. Saving a pin does not prompt
  either: a pin is data, inert but valid without the permission, so storing one costs nothing
  and refusing to store one would only discard what you typed. Once a pin exists the editor says
  it is not active yet and offers **Enable Pin to URL**, which is the only thing that raises the
  prompt. Declining leaves the pins saved and inert. Clearing a pin never needs it. Revoking it
  later leaves your notes intact. See
  [PRIVACY.md](PRIVACY.md#pin-to-url-and-the-one-optional-permission).

- **A "show hidden" toggle in the tab strip**, which appears whenever a pin is hiding something
  and reveals all of it in one click. A pin hides, it never deletes, and a forgotten pin must
  never be mistakable for lost notes.

- **A Chrome build**, published as
  [Noutieren on the Chrome Web Store](https://chromewebstore.google.com/detail/noutieren/fehabengonhjmgghempjpcgfkggppknf)
  and documented in [`chrome_version/`](chrome_version/README.md). The toolbar button
  opens an 800×600 popup — Chrome has no sidebar API — and the full-page tab works as it does
  on Firefox. Verified in Chromium 150.
- **`npm run verify:chrome`**, which loads the built extension into a headless Chromium under
  a throwaway profile and drives it over the DevTools protocol: that Chrome accepts the
  manifest and the strict CSP, that the popup renders at the size it declares, and that text
  typed a moment before the popup is destroyed survives. Eighteen checks.
- **Teardown handoff for autosave.** Chrome destroys a popup's document the moment it loses
  focus, taking any open IndexedDB transaction with it, so a write started there is
  unreliable. The Chrome build now hands pending patches to its service worker, which outlives
  the popup. Firefox is unchanged and still flushes in place; the seam is an injected function
  rather than a build flag, so both paths are covered by tests.

### Changed

- **Database schema version 3.** Additive only: tabs and notes may now carry a `urlPatterns`
  field. There is no upgrade step, because a row without the field is exactly what an unpinned
  item looks like, so every existing row is already correct.
- **Backups carry pins**, at format version 1 as before. The addition is backward compatible:
  1.2.0 can still read a 1.3.0 backup, and simply ignores the pins.
- `scripts/verify-build.mjs` now checks required and optional permissions separately. The
  required list is still pinned to exactly `storage` and `unlimitedStorage`, and moving `tabs`
  into it fails the build rather than passing it.
- `chrome_version/` holds only what Chrome needs differently — a manifest, two HTML entries, a
  service worker and two Vite configs. There is no second copy of the application: it builds
  from the same `src/`, and `npm run check` builds both targets so shared changes cannot break
  Chrome silently.
- `getBrowserApi()` falls back to Chrome's `chrome` namespace, testing `runtime.id` to avoid
  mistaking the unrelated `chrome` object on ordinary web pages for the extension API.
- `scripts/verify-build.mjs` takes `--target=firefox|chrome` and applies each browser's
  manifest expectations. The self-containment audit is identical for both.

### Fixed

- **A refused request for persistent storage is no longer reported as an error.** Chrome
  declines `navigator.storage.persist()` for extension origins even with `unlimitedStorage`
  (measured on Chromium 150: `persist()` returns false while the quota is lifted to ~32 GB),
  so every launch would have logged an error claiming data "may be evicted" — misleading about
  the permission that actually protects it. It is now a single `console.debug` line, and the
  wrong comment asserting extensions are granted this without a prompt has been corrected.
  Firefox behaviour is unchanged: it still grants persistence.
- **Startup notices no longer appear under "Errors" in `chrome://extensions`.** That panel
  collects `console.warn` as well as `console.error`, so the storage-durability line above was
  listed there on every launch, once per context — two entries as soon as the full page was
  opened from the popup, looking for all the world like a crash. `logWarning` now logs at
  `debug`, which the panel does not collect and DevTools still shows under Verbose.
  `verify:chrome` asserts nothing is logged at `warn` level so it cannot come back.

### Pin to URL on Chrome

Shipping in both builds. One difference, forced by the platform:

- **Chrome destroys the toolbar popup the moment it loses focus**, which is exactly what a
  permission dialog does — the document is gone before the user can answer, so from a popup the
  permission cannot merely fail to be granted, it cannot be _asked_. **Enable Pin to URL**
  therefore opens the full-page view, an ordinary tab that survives losing focus, and prompts
  there. Firefox's sidebar stays open and prompts in place. The surface test is
  `canPromptForPermission()`, so neither build guesses.
- **The tab that opens leads with the request.** It carries `?grant=pins` and shows a banner
  with a **Grant access** button; an ordinary "Full page" tab shows nothing. Without this the
  hand-off simply landed on the editor having asked for nothing, which read as the button
  misfiring.
- `npm run verify:chrome` grew from 18 checks to **28**, all passing on Chromium 151. The new
  ones confirm `tabs` is declared optional and not required, that a fresh profile does not hold
  it, that `chrome.tabs.query` yields no URL without it, and that a tab pinned to a site that is
  not open — written straight into IndexedDB, so the app must read a pin it did not create —
  stays **visible**. Pins fail open, never closed. The prompt itself is browser UI and remains a
  manual check.

## 1.2.0 — 2026-07-25

Prepared for a listed addons.mozilla.org submission, where people arrive without having read
any documentation. **Since approved and published** as
[Noutieren (Notes)](https://addons.mozilla.org/en-US/firefox/addon/noutieren-notes/) — this is
the version on the store.

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
