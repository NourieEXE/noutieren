# Developing Noutieren

Notes for working on the code. For what the extension does, see the [README](README.md).

## Setup

You need Node.js 22 or newer. There is an `.nvmrc`, so `nvm use` picks the right one.

```bash
npm install
```

## Running it

```bash
npm run dev       # the app in a normal browser tab, with hot reload
npm run firefox   # builds it and opens a test copy of Firefox with it installed
```

`npm run dev` runs outside an extension, so anything that needs the browser's extension APIs
(pins, reminders, the toolbar badge) does nothing there. Preferences are kept in
`localStorage` instead.

To load your own build in your normal Firefox:

1. `npm run build`
2. Open `about:debugging#/runtime/this-firefox` and choose Load Temporary Add-on.
3. Pick `dist/manifest.json`.

A temporary add-on is gone when Firefox closes. It also gets its own storage, so your real
notes won't be in it, and it can't touch them.

For Chrome: `npm run build:chrome`, then in `chrome://extensions` turn on Developer mode,
choose Load unpacked, and pick `chrome_version/dist`.

## Commands

| Command                  | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `npm run build`          | Firefox build in `dist/`, then checks it                         |
| `npm run build:chrome`   | Chrome build in `chrome_version/dist/`, then checks it           |
| `npm run package`        | Firefox zip for the store, in `web-ext-artifacts/`               |
| `npm run package:chrome` | Chrome zip for the store, in `chrome_version/web-ext-artifacts/` |
| `npm run test`           | Tests, rerunning on every change                                 |
| `npm run test:run`       | Tests, once                                                      |
| `npm run typecheck`      | TypeScript                                                       |
| `npm run lint`           | ESLint and Prettier                                              |
| `npm run check`          | All of the above, both builds, and `web-ext lint`                |
| `npm run verify:chrome`  | Loads the Chrome build in a headless Chromium and tries it out   |

Run `npm run check` before every commit you mean to release. It builds the Chrome version
too, so a change that breaks Chrome fails there and not later.

Every build is checked by `scripts/verify-build.mjs`. It fails if a file is missing, if a
source map slipped in, if anything points at the internet, or if the code uses `eval`. It
also fails if the permissions or the content security policy get looser than they are now.

## How the code is laid out

```text
public/           Firefox manifest
chrome_version/   What Chrome needs differently; see chrome_version/README.md
scripts/          Icon drawing, build checks, Chrome packaging, store screenshots
src/
  app/            Startup and the main app component
  background/     Firefox background page: opens the sidebar, fires reminders
  components/     Everything you see: tab strip, notes list, editor, dialogs, menus
  database/       The database and everything that reads or writes it
  editor/         The text editor setup, and cleaning up imported notes
  hooks/          Small React helpers
  services/       Saving, backups, preferences, reminders, pins, permissions
  styles/         One stylesheet for everything, light and dark
  types/          Shared TypeScript types
  utils/          Colours, dates, ids, URL patterns
  releaseNotes.ts What the What's new page shows
tests/            Tests (Vitest)
```

Components never touch the database directly. They go through `src/database/` and
`src/services/`.

`chrome_version/` holds no copy of the app. It has the Chrome manifest, two HTML pages, the
service worker and two Vite configs, and everything else comes from `src/`.

## How notes are stored

Notes live in the browser's IndexedDB, in a database called `colornote-tabs`:

- `tabs`: one row per tab.
- `notes`: each note's title, colour, position, plain text (for search), pins and reminder.
- `contents`: each note's formatted text. It is kept apart so that lists and search never
  have to load it.
- `trash`: Recently deleted. A deleted note, its text and a copy of its tab, so restoring
  it can bring the tab back too. Anything older than 30 days is removed when Noutieren opens.
- `meta`: the schema version.

Small settings (theme, which tab was open, how often reminders repeat) live in
`browser.storage.local`. After an update it also holds the previous version number, until
the "updated" line is closed.

To change the database, add a new `this.version(n)` block in `src/database/db.ts` and bump
`SCHEMA_VERSION`. Never edit an old block: browsers that already have that version would fail
to open the database.

If the sidebar and the full page are both open, they share the same data and update each
other. Every save remembers which version of the note it started from. If the other view
saved first, you are asked which version to keep, so nothing is overwritten silently.

## Two names you must never change

Both still say `colornote-tabs`, from before the extension was renamed.

| Name                                                                           | Why                                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| The Firefox id, `browser_specific_settings.gecko.id` in `public/manifest.json` | Firefox stores the notes under this id. A new id means a new, empty extension, and AMO sees a different add-on. |
| `DATABASE_NAME` in `src/database/db.ts`                                        | The database's name. A new name opens a new, empty database.                                                    |

Changing either makes everyone's notes look gone. If one ever has to change, add code that
copies the old data over, or have people export first and import after.

The display name (Noutieren) can change freely.

## Releasing a new version

1. Write what changed for users in `src/releaseNotes.ts`, and for developers in
   `CHANGELOG.md`. A test fails if the two don't list the same versions and dates, or if the
   version you're building has no notes.
2. Change `version` in `package.json`, `public/manifest.json` and
   `chrome_version/public/manifest.json`. The stores refuse a version they have seen before.
3. `npm run check`.
4. Commit, tag (`vX.Y.Z`), then `npm run package` and `npm run package:chrome`.
5. Upload. AMO also wants the source, because the code is bundled:
   `git archive --format=zip -o source.zip vX.Y.Z -- . ':(exclude)docs'`.
   [BUILDING.md](BUILDING.md) tells the reviewer how to rebuild it.

Users get the update through the store and keep their notes, because the id stays the same.

To install a build of your own permanently in normal Firefox, it has to be signed. Upload the
zip to [addons.mozilla.org](https://addons.mozilla.org/developers/) as an unlisted add-on, or
use Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to `false`.

## Pin patterns in detail

Pins use the browser's own match pattern format, `<scheme>://<host><path>`.

- A trailing `/` means only that page. `/*` means every page on the site.
- `*.example.com` covers `example.com` and its subdomains, but not `notexample.com`.
- The part after `?` is matched. The part after `#` never is.
- Only `http` and `https` pages can be pinned, so a pin never matches the browser's own pages.
- A missing scheme becomes `*://`, and a missing path becomes `/`. Nothing else is filled in.
- A pin with several patterns shows on a page that matches any of them.
- Without the `tabs` permission, or when the address is unknown, pins show everything instead
  of hiding it. Hiding would look like lost notes.
- The full-page view ignores pins, so it's always a way back to everything.

Matching is in `src/utils/matchPattern.ts`. It doesn't use regular expressions on purpose: a
pattern with many `*`s could take minutes to check that way.

## The Chrome version

It is built from the same code, with a few differences. Details are in
[chrome_version/README.md](chrome_version/README.md).

- A popup instead of a sidebar, since Chrome has no sidebar for this. The popup is 800 by
  600 pixels, which is as big as Chrome allows.
- Chrome closes the popup the moment it loses focus, which can cut off a save. So when the
  popup closes, it hands any unsaved text to the service worker, which writes it.
- The popup can't ask for permissions either, because the permission prompt closes it. It
  opens the full page to ask instead.
- Notes don't move between Firefox and Chrome. Use export and import.

## Tests

`npm run test:run` runs them all. They cover tabs, notes, saving (including switching notes
quickly and storage errors), search, backups and imports, Recently deleted, reminders, pins,
the What's new page, and the Chrome-only parts. They run in Node with a fake IndexedDB, so
`npm run verify:chrome` exists to try the real thing in Chromium.

## Known limitations

- `web-ext lint` shows four warnings, all inside React and ProseMirror code that sets
  `innerHTML`. One of them never runs, and the other three can't be removed without changing
  those libraries.
- Search reads through every note's text. That's fine for a few thousand notes, but would
  get slow with far more.
- Notes are reordered with Move up and Move down in their menu, not by dragging.
- Two open windows can show different notes. Only the theme is shared between them.
- Reminders don't repeat on a schedule, like every day or every week.
- There is no Firefox for Android version, since it has no sidebar.
