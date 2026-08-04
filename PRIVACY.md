# Privacy policy — Noutieren

**Last updated: 4 August 2026**

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
- No content scripts and no host permissions, so the extension cannot see, read or modify the
  _contents_ of any web page you visit — including the page in the tab next to the sidebar.

The extension requests exactly two permissions at install time:

| Permission         | Why                                                                |
| ------------------ | ------------------------------------------------------------------ |
| `storage`          | To save your notes and interface preferences on this device.       |
| `unlimitedStorage` | So your notes are not capped by the small default extension quota. |

Its manifest declares `data_collection_permissions: { required: ["none"] }` — Firefox's formal
statement that no data is collected.

## Pin to URL, and the one optional permission

Added in 1.3.0. _Pin to URL_ lets you say that a tab or a note should only appear while a
particular page is open — for example, notes that only show up on YouTube. To do that, Noutieren
has to know the address of the tab you are currently on, which needs the browser's `tabs`
permission.

That permission is **optional and off by default**:

- It is not requested when you install or update. If you never create a pin, Noutieren is never
  granted it and nothing about the above changes.
- Saving a pin does not ask for it. A pin is just stored text, and it does nothing at all until
  the permission is held, so there is nothing to gate. Once you have a pin, the editor says it
  is not active yet and offers an **Enable Pin to URL** button — that button is the only thing
  that ever raises the prompt.
- Declining is a supported answer. Your pins stay saved and stay inert, and everything else
  keeps working exactly as before.
- Removing a pin never requires it, so you can always undo the feature.
- You can withdraw it at any time — **Add-ons → Noutieren → Permissions** on Firefox,
  **Details → Site settings** on Chrome. Existing pins stop taking effect and everything
  becomes visible again; no notes are lost.

On Chrome the prompt is raised from the full-page view rather than the toolbar popup, because
Chrome closes the popup as soon as a dialog takes focus. It asks for the same one permission.

While the permission is granted:

| What Noutieren reads                                | What it does with it                                   |
| --------------------------------------------------- | ------------------------------------------------------ |
| The address of the active tab in the current window | Compares it, in memory, against the patterns you typed |
| Nothing else                                        | —                                                      |

The address is never written to the database, never written to `browser.storage.local`, never
included in an export, and never sent anywhere — there is still no network code in the extension
at all. It is held in memory by the open sidebar and is gone when you close it. Noutieren still
cannot read the _content_ of any page, only the address of the tab, and only while you have a
pin-capable view open.

The URL patterns you type are stored with your tabs and notes, and are included in backups.

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
