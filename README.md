# Noutieren

**Private, local-first notes in the Firefox sidebar, organized into color-labeled tabs.**

Rich text, instant local search, and JSON backups — with no account, no sync, no telemetry,
and no network requests of any kind. Two permissions at install: `storage` and
`unlimitedStorage`, plus one optional permission you are only ever asked for if you use
[Pin to URL](#pin-to-url).

It lives in the sidebar, and opens in a full browser tab when you want more room.

<p align="center">
  <img src="docs/noutieren.png" alt="Noutieren open in the Firefox sidebar: a tab strip with two color-labeled tabs, a notes list, and the rich-text editor below it" width="360">
</p>

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/noutieren-notes/"><strong>Install for Firefox →</strong></a>
  &nbsp;·&nbsp;
  <a href="https://chromewebstore.google.com/detail/noutieren/fehabengonhjmgghempjpcgfkggppknf"><strong>Install for Chrome →</strong></a>
  &nbsp;·&nbsp;
  <a href="chrome_version/README.md">Chrome build notes</a>
</p>

<p align="center"><sub>Everything below is for building it yourself. To just use it, the link above is all you need.</sub></p>

| At a glance    |                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Install**    | [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/noutieren-notes/) · [Chrome Web Store](https://chromewebstore.google.com/detail/noutieren/fehabengonhjmgghempjpcgfkggppknf) |
| **Status**     | Published on AMO and the Chrome Web Store; in daily use                                                                                                                                         |
| **Requires**   | Firefox 142+ (desktop), or Chrome 111+                                                                                                                                                          |
| **Built with** | React · TypeScript · Vite · Tiptap/ProseMirror · Dexie/IndexedDB                                                                                                                                |
| **Tests**      | 315, plus typecheck, lint, a build audit and `web-ext lint`                                                                                                                                     |
| **License**    | MIT                                                                                                                                                                                             |
| **Privacy**    | No data collected — see [PRIVACY.md](PRIVACY.md)                                                                                                                                                |
| **Building**   | Reproducible build steps in [BUILDING.md](BUILDING.md)                                                                                                                                          |
| **Chrome**     | Popup build — [store listing](https://chromewebstore.google.com/detail/noutieren/fehabengonhjmgghempjpcgfkggppknf), notes in [chrome_version/](chrome_version/README.md)                        |

### Quick start

Installing from
[addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/noutieren-notes/) needs
nothing but a click. To build from source instead:

```bash
npm install
npm run build        # unpacked extension in dist/
npm run firefox      # or: load dist/manifest.json via about:debugging
```

Other install routes, including signing your own build for permanent installation, are under
[Installing permanently](#installing-permanently-signing).

### Contents

- [Features](#features) · [Pin to URL](#pin-to-url) · [Privacy](#privacy) · [Requirements](#requirements)
- [Install](#install-dependencies) · [Development](#run-in-development) · [Build](#build) · [Package](#package-with-web-ext)
- [Installing permanently](#installing-permanently-signing) · [Keyboard shortcuts](#keyboard-shortcuts)
- [Data storage](#data-storage) · [Renaming and identifiers](#renaming-and-identifiers) · [Re-signing](#making-changes-and-re-signing)
- [Export and import](#export-and-import) · [Project structure](#project-structure) · [Testing](#testing-and-checks) · [Known limitations](#known-limitations)
- [Chrome](#chrome)

## Features

- **Color-labeled tabs.** Any number of tabs, each with its own name and color, reorderable,
  with a note count. Selected tabs are filled with their own color using a foreground chosen
  for contrast, never text dropped onto an arbitrary background.
- **Notes in every tab.** No limit beyond your disk. Each note has its own title, color,
  position, last-updated time and plain-text preview.
- **Rich text** via Tiptap/ProseMirror: bold, italic, underline, strikethrough, paragraph,
  headings 1–3, bulleted, numbered and check lists, block quotes, inline code, code blocks,
  links, undo/redo and clear formatting. Toolbar buttons show active state, disable when
  unavailable, and keep your text selection.
- **Autosave.** Debounced ~400 ms, flushed immediately on note switch, blur, tab hide,
  window unload and Ctrl/Cmd+S, with a `Saving…` / `Saved` indicator.
- **[Pin to URL](#pin-to-url).** A tab or a single note can be set to appear only while a
  particular page is open, using standard match patterns such as `https://*.youtube.com/*`.
  On both Firefox and Chrome.
- **Local search** over note titles and text, in the current tab or across all tabs.
- **Backup.** Export everything to one readable JSON file; import it back by replacing or
  merging; reset to a clean slate.
- **Light, dark and system themes**, keyboard navigation throughout, and a layout that works
  from a 320 px sidebar to a full window.

## Screenshots

| Tab settings                                                                                                                                                                                                                                            | Note actions                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <img src="docs/tab_settings.png" alt="Tab settings dialog: name field, a twelve-swatch color palette with the selected one check-marked, a custom color input, move left and right buttons, the tab's note count, and a Delete tab button" width="330"> | <img src="docs/note_settings.png" alt="Note actions menu: duplicate note, move up and move down greyed out for a single note, move to tab, and delete note" width="330"> |

Selection is never signalled by color alone — the chosen swatch carries a check mark and the
value is printed as text. Controls that cannot act are disabled rather than hidden.

## Pin to URL

A tab, or one individual note, can be pinned so that it only appears while a matching page is
open. Set it in **Tab settings → Pin to URL**, or **Note actions → Pin to URL…**.

Patterns use the standard
[WebExtension match-pattern](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Match_patterns)
syntax, `<scheme>://<host><path>`:

| Pattern                                       | Matches                                     |
| --------------------------------------------- | ------------------------------------------- |
| `https://www.youtube.com/watch?v=eDQtUwad5vg` | that one video, and nothing else            |
| `https://www.youtube.com/`                    | the YouTube home page only                  |
| `https://*.youtube.com/*`                     | all of YouTube, including `music.` and `m.` |
| `https://example.com/docs/*`                  | anything under `/docs/`                     |
| `*://example.com/*`                           | either scheme                               |
| `youtube.com`                                 | shorthand — read as `*://youtube.com/`      |

**Nothing is ever widened for you.** What you type is what is stored:
`https://www.youtube.com/` pins the home page and only the home page. To cover a whole site,
either type the `*` yourself or tick **Also match everything under this address**, which shows
you the exact pattern it will save before you add it. The field always prints the final
string, so a pin can never come back broader than the one you entered.

Details worth knowing:

- A trailing `/` means the root path **only**; `/*` means everything on the host. This is the
  difference between pinning to a site's home page and pinning to the whole site.
- `*.example.com` matches `example.com` itself as well as its subdomains, and cannot be
  satisfied by a lookalike such as `notexample.com`.
- The query string is matched; the `#fragment` never is.
- Only `http` and `https` can be pinned, so a pin never matches `about:`, `file:` or the
  extension's own pages.
- Only two things are filled in, because only one reading is possible: a missing scheme
  (`example.com` → `*://example.com/`) and a missing path (`https://example.com` →
  `https://example.com/`, as a browser would read the same text).
- Multiple patterns act as "or" — the item shows if any one of them matches.

Pins **hide, they never delete**. Whenever a pin is hiding something, a pin button appears in
the tab strip showing how many items are affected; one click reveals all of them. Pins also do
not apply in the full-page view, which is itself a browser tab, so that is always a way back to
everything.

### The optional permission

Matching against the current page means knowing its address, which needs the `tabs`
permission. It is **optional and off by default**:

- Not requested at install or on update — no existing install is disabled pending approval.
- Saving a pin never prompts. Pins are data: they store fine and sit inert until the permission
  is held, so nothing you type is thrown away and nothing is asked for before you have shown
  you want the feature.
- Once a pin exists, the editor says it is not active yet and offers **Enable Pin to URL**.
  That button is the only thing that ever raises the prompt.
- Clearing a pin never needs it.
- Revoke it any time — **Add-ons → Noutieren → Permissions** on Firefox, **Details → Site
  settings** on Chrome. Pins become inert, everything becomes visible, no notes are lost.

Pins **fail open, never closed**: without the permission, or when the address is unknown,
everything is shown. Failing the other way would be indistinguishable from losing notes.

The address is compared in memory and never stored, exported or transmitted. Noutieren still
cannot read the _contents_ of any page. See [PRIVACY.md](PRIVACY.md) for the full statement,
and [docs/permissions.md](docs/permissions.md) for the store-listing wording.

**On Chrome the prompt appears in the full-page view.** Chrome destroys the toolbar popup the
moment it loses focus, which is exactly what a permission dialog does — the popup would be gone
before you could answer, so the request cannot merely fail there, it cannot be asked. **Enable
Pin to URL** therefore opens the full page and asks there. Grant it, close the tab, and pins
work in the popup from then on. Firefox's sidebar stays open, so it prompts in place.

## Privacy

- No network requests. No analytics, telemetry, ads, accounts, or cloud sync.
- No content scripts and no host permissions. The extension cannot see the contents of any web
  page you visit.
- Two permissions are requested at install: `storage` and `unlimitedStorage`. One further
  permission, `tabs`, is optional and requested at runtime only if you use
  [Pin to URL](#pin-to-url).
- All code and dependencies are bundled locally. The build is verified to contain no remote
  scripts, styles, fonts or `eval`-style dynamic code.
- Your notes live in this Firefox profile's IndexedDB. Deleting the extension's data or the
  profile deletes the notes.

## Requirements

- **Firefox 142 or newer** (the manifest declares `strict_min_version: 142.0`).
- **Node.js 22 or newer** for development. An `.nvmrc` is included:

  ```bash
  nvm use
  ```

## Install dependencies

```bash
npm install
```

## Run in development

For fast UI iteration in a normal browser tab (Vite dev server, hot reload):

```bash
npm run dev
```

Outside an extension context the WebExtension APIs are absent, so the sidebar-specific
buttons fall back gracefully and preferences use a local fallback store. To exercise the real
extension, load it in Firefox:

```bash
npm run firefox
```

This builds `dist/` and launches a temporary Firefox profile with the extension installed and
auto-reloading on source changes.

## Temporary installation through about:debugging

```bash
npm run build
```

Then, in Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…**.
3. Select `dist/manifest.json`.
4. Click the Noutieren toolbar button to open the sidebar. If the toolbar button is
   hidden, find it in the toolbar overflow (**»**) menu, or open the sidebar from
   **View → Sidebar → Noutieren**.

A temporary add-on is removed when Firefox closes. Your notes survive, because they are
stored per extension ID in the profile.

## Build

```bash
npm run build
```

Produces the complete unpacked extension in **`dist/`**, with `dist/manifest.json` at its
root. The build runs four steps: generating the PNG icons, bundling the UI, bundling the
background script, and then auditing the output (`scripts/verify-build.mjs`) for missing
files, source maps, remote references and dynamic code.

## Package with web-ext

```bash
npm run package
```

Creates **`web-ext-artifacts/noutieren-1.3.0.zip`** (about 237 KB). Source maps are
excluded and no development files are included.

## Installing permanently (signing)

The published build is on
[addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/noutieren-notes/) and
installs like any other add-on — signed, auto-updating, nothing below required. This section
is for installing a build **you** made.

Firefox will not permanently install an unsigned extension in the release or beta channels.
To install your own build permanently you need one of:

- **Sign it through addons.mozilla.org (AMO).** Submit the zip from `npm run package` to
  <https://addons.mozilla.org/developers/> as an unlisted add-on, or run
  `npx web-ext sign --api-key=… --api-secret=… --channel=unlisted --source-dir dist`
  with credentials from <https://addons.mozilla.org/developers/addon/api/key/>. That yields a
  signed `.xpi` you can install from `about:addons` → gear icon → **Install Add-on From File…**.
- **Or use Firefox Developer Edition, Nightly, or ESR**, where setting
  `xpinstall.signatures.required` to `false` in `about:config` permits unsigned installs.
- **Or reload it as a temporary add-on** each session, as described above.

The extension ID is `colornote-tabs@local.extension`. It keeps its pre-rename spelling
deliberately — see _Renaming and identifiers_ below.

## Keyboard shortcuts

| Keys                   | Action                                      |
| ---------------------- | ------------------------------------------- |
| `Ctrl/Cmd + N`         | New note in the current tab                 |
| `Ctrl/Cmd + Shift + N` | New tab                                     |
| `Ctrl/Cmd + K`         | Focus the search box                        |
| `Ctrl/Cmd + S`         | Write pending changes immediately           |
| `Escape`               | Close the open dialog or menu               |
| `Ctrl/Cmd + B / I / U` | Bold / italic / underline                   |
| `Ctrl/Cmd + Shift + S` | Strikethrough                               |
| `Ctrl/Cmd + E`         | Inline code                                 |
| `Ctrl/Cmd + Z`         | Undo                                        |
| `Ctrl/Cmd + Shift + Z` | Redo                                        |
| `← / →`, `Home`/`End`  | Move between tabs, then `Enter` to open one |

The same list is available in the app from the **?** button.

Firefox reserves some shortcuts for itself; depending on your platform and focus, `Ctrl+N`
may open a browser window instead of a note. The **New note** button always works.

## Data storage

- **IndexedDB** (`colornote-tabs` database — see _Renaming and identifiers_) holds tabs, note metadata and rich-text
  documents. Notes are split across two tables — `notes` for metadata and `contents` for
  documents — so listing, previewing and searching never deserialise a single editor
  document. Indexes exist for notes by tab, notes by tab and position, notes by updated time,
  and tabs by position.
- **URL pins** are stored as an optional `urlPatterns` array on the tab or note row itself.
  It is unindexed — visibility is decided in memory over the tab list and the open tab's
  notes, never by a range query — and absent rather than empty when an item is unpinned, so
  every row written before 1.3.0 is already a correct unpinned row.
- **`browser.storage.local`** holds only small UI preferences: selected tab and note,
  collapsed panel, theme, search scope, and whether the "show hidden" pin override is on.
- `unlimitedStorage` is requested so notes are not capped by the default extension quota.
- The schema is versioned (`SCHEMA_VERSION` in `src/database/db.ts`) with Dexie migrations, so
  future changes upgrade existing data instead of discarding it. To add one, append a new
  `this.version(n)` block with an `.upgrade()` handler — never edit an existing block.

Two open views (sidebar and full page) work on the same data and update live. Each save
carries the version it was based on: if the other view wrote first, the save is refused and
you are asked which version to keep, rather than one silently overwriting the other.

## Renaming and identifiers

The product name is display text and can be changed freely: the manifest `name` and titles,
the header in the app, the backup filename prefix, and `APPLICATION_NAME`. Import deliberately
does not check what a backup calls itself, so files exported under an older name still load
(there is a test for exactly that).

Two values are **storage identities and must not be changed casually.** Both still read
`colornote-tabs`, from before the extension was renamed to Noutieren:

| Value                                           | Why it is frozen                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `browser_specific_settings.gecko.id` (manifest) | Firefox maps the extension ID to the `moz-extension://` UUID that owns the database. A new ID means a new, empty origin — and AMO treats it as a brand-new add-on. |
| `DATABASE_NAME` (`src/database/db.ts`)          | Names the IndexedDB database itself. Changing it opens a different, empty one.                                                                                     |

Changing either makes every existing note appear to vanish. If one ever has to change, ship a
migration that copies the old data across, or require users to export first and import after.

## Making changes and re-signing

Any change to the packaged files invalidates the AMO signature, so shipping an update means:

1. Edit the source.
2. Bump `version` in `public/manifest.json` — AMO rejects a version number it has already seen.
3. `npm run check` (typecheck, lint, tests, build, extension lint).
4. `npx web-ext sign --source-dir dist --channel=unlisted` with your API credentials in
   `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`.
5. Install the new `.xpi` over the old one. Because the extension ID is unchanged, it upgrades
   in place and keeps existing notes.

## Export and import

**Export** (settings menu → _Export all data…_) writes one readable JSON file named
`noutieren-backup-YYYY-MM-DD.json`, containing the application name, format version,
export timestamp, schema version, every tab, every note (with its document, color, position
and timestamps) and your preferences.

**Import** (settings menu → _Import data…_) parses and validates the file before touching the
database. It checks ids, tab references, colors, positions, timestamps and editor content,
rejects files it cannot read with a specific reason, and rebuilds every document from an
allowlist so nothing in a file can become executable markup. Then you choose:

- **Merge** — keeps your current notes and adds the imported ones, giving new ids to anything
  that would collide and repairing references so imported notes stay with their imported tabs.
- **Replace** — deletes current data first. A safety backup of your existing data is
  downloaded automatically before anything is removed.

**Reset** (settings menu → _Reset all data…_) deletes everything after an explicit
confirmation and recreates the default `General` tab.

## Project structure

```text
public/
  manifest.json          Firefox MV3 manifest (action, sidebar_action, background, CSP)
  icons/                 PNG icons generated by scripts/generate-icons.mjs
scripts/
  generate-icons.mjs     Draws and encodes the icons with only Node's zlib
  verify-build.mjs       Audits a build for completeness and self-containment
  package-chrome.mjs     Writes a reproducible Chrome Web Store zip using only zlib
src/
  app/                   Entry point, mount, bootstrap, shell, error boundary, workspace state
  background/            Event page: toolbar click opens the sidebar
  components/            Tab strip, notes panel, editor pane, dialogs, menus, toasts
  database/              Dexie schema and migrations, tab and note repositories
  editor/                Tiptap setup, toolbar, plain-text extraction, import sanitizer
  hooks/                 Contexts, autosave status, theme, shortcuts, list windowing, active URL
  services/              Autosave queue, preferences, backup, workspace, errors, WebExt API,
                         active-tab URL + optional permission, URL-pin visibility rules
  styles/                One stylesheet, custom properties, light/dark, container queries
  types/                 Shared types and the `browser`/`chrome` namespace declarations
  utils/                 Colors, ids, time, download, link URLs, URL match patterns
chrome_version/          The Chrome delta only — see chrome_version/README.md
tests/                   Vitest suites (fake-indexeddb + React Testing Library)
```

Components never touch IndexedDB directly; all access goes through the repositories in
`src/database/` and the services in `src/services/`.

`chrome_version/` contains **no copy of the application**. It holds a Chrome manifest, two
HTML entries, a service worker and two Vite configs that build from this same `src/`.

## Testing and checks

```bash
npm run test        # Vitest in watch mode
npm run test:run    # single run
npm run typecheck   # tsc --noEmit, strict
npm run lint        # ESLint (type-aware) + Prettier check
npm run webext:lint # web-ext lint against dist/
npm run check       # typecheck + lint + tests + both builds + web-ext lint
```

232 tests cover creating, renaming, recoloring, reordering and deleting tabs; creating,
moving, duplicating, reordering, deleting and restoring notes; autosave debouncing, flushing
on note switch, and the guarantee that one note never receives another's content; storage
failures keeping typed text; conflict detection between views; search within one tab and
across all tabs; export format; valid, invalid and merging imports; import sanitizing; reset;
the v1→v2 database migration; selection restore; keyboard shortcuts; WCAG AA contrast for
every palette color; and — for the Chrome build — namespace detection, popup view detection,
message validation, and which teardown path runs on `pagehide`.

`npm run check` builds the Chrome target too, so a change to shared code that breaks it fails
here rather than silently later.

## Chrome

There is a Chrome build in [`chrome_version/`](chrome_version/README.md). Firefox is the
primary target and gets changes first; Chrome is rebuilt on request.

```bash
npm run build:chrome    # unpacked extension in chrome_version/dist/
npm run verify:chrome   # loads it into a headless Chromium and drives it
npm run package:chrome  # a Chrome Web Store zip
```

Load it at `chrome://extensions` → **Developer mode** → **Load unpacked** →
`chrome_version/dist`.

`verify:chrome` covers what jsdom cannot: that Chrome accepts the manifest and the strict
CSP, that the popup renders at the size it declares, and — the one that matters — that text
typed a moment before the popup is destroyed is still there when it reopens. Eighteen checks,
all passing on Chromium 150.

Three things differ from Firefox:

- **A popup instead of a sidebar.** Chrome has no equivalent sidebar API. The popup is
  800×600, Chrome's maximum, which is wide enough for the same two-pane layout a wide Firefox
  sidebar gets — the container queries handle it, with no Chrome-specific CSS.
- **A service worker instead of an event page**, which is also what makes autosave safe:
  Chrome destroys a popup's document the instant it loses focus, so pending writes are handed
  to the worker rather than started in a document that is about to disappear.
- **No Gecko manifest keys**, and so no shared extension id — meaning **notes do not move
  between Firefox and Chrome.** Use export and import.

The full account, including what to check on first load and the extension-id trap to avoid
before publishing, is in [`chrome_version/README.md`](chrome_version/README.md).

## Known limitations

- **`web-ext lint` reports four `UNSAFE_VAR_ASSIGNMENT` warnings** (0 errors). All four are
  `innerHTML` assignments inside bundled React and ProseMirror code — React's
  `dangerouslySetInnerHTML` support, its `<script>` element creation path, ProseMirror's
  clipboard serialiser, and Tiptap's stylesheet injector. The last one never executes: the
  editor is created with `injectCSS: false` and those rules ship as static CSS instead. The
  remaining three cannot be removed without patching the libraries.
- **Search is a substring scan** over locally stored note metadata, not an inverted index. It
  is comfortable into the low thousands of notes; a much larger collection would want a real
  index.
- **Note reordering uses menu commands** (_Move up_ / _Move down_), not drag and drop, which
  keeps it fully keyboard accessible. Tabs reorder from the tab settings dialog.
- **New notes are appended** to the end of a tab, which keeps creation O(1) rather than
  renumbering every row in the tab.
- **Selection is not mirrored between views.** Two windows can sit on different notes on
  purpose; only the theme follows across views.
- **`Ctrl+N` may be intercepted by Firefox** before the extension sees it, depending on
  platform and focus.
- **Firefox for Android is not supported** — it has no extension sidebar.
- **The bundle is a single ~750 KiB file** (~235 KiB gzipped): React, ProseMirror and Dexie.
  Code splitting would add nothing, since everything loads from local files.

## License

MIT
