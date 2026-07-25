# Privacy policy — Noutieren

**Last updated: 25 July 2026**

Noutieren does not collect, transmit, sell or share any data. There is no server to send
anything to.

## What the extension stores, and where

Everything you type stays in your own Firefox profile on your own device:

- **Your tabs, notes and their formatted content** are stored in this profile's IndexedDB
  database, under the extension's own origin.
- **A few interface preferences** — which tab and note you had open, whether the notes list is
  collapsed, your theme, your search scope, and the date of your last backup — are stored in
  `browser.storage.local`.

Neither is readable by websites you visit, by other extensions, or by the author.

## What the extension does not do

- No network requests of any kind. The packaged build is verified at build time to contain no
  remote scripts, stylesheets, fonts or fetch calls, and its content security policy sets
  `connect-src 'none'`.
- No analytics, telemetry, crash reporting, advertising or tracking.
- No accounts, no sign-in, no cloud sync.
- No content scripts and no host permissions, so the extension cannot see, read or modify any
  web page you visit — including the page in the tab next to the sidebar.

The extension requests exactly two permissions:

| Permission         | Why                                                                |
| ------------------ | ------------------------------------------------------------------ |
| `storage`          | To save your notes and interface preferences on this device.       |
| `unlimitedStorage` | So your notes are not capped by the small default extension quota. |

Its manifest declares `data_collection_permissions: { required: ["none"] }` — Firefox's formal
statement that no data is collected.

## Backups you create

_Export all data_ writes a JSON file to wherever your browser saves downloads. That file
contains your notes in readable form. It is written by your browser to your disk and is not
uploaded anywhere. Once it exists, looking after it is up to you.

## Deleting your data

- _Reset all data_ in the settings menu deletes every tab and note immediately.
- Uninstalling the extension, or deleting your Firefox profile, removes the database with it.

Because nothing leaves your device, there is nothing for the author to delete on your behalf,
and no request procedure to follow.

## Contact

Questions or reports: <https://github.com/NourieEXE/noutieren/issues>
