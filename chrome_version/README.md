# Noutieren for Chrome

The Chrome build of [Noutieren](../README.md). Firefox is the primary target; this
directory holds only what Chrome needs differently.

> **Verified in Chromium 150.** Loaded as an unpacked extension and driven over the
> DevTools protocol: the manifest and CSP are accepted, the popup renders at the
> size it declares, and text typed a moment before the popup is destroyed is still
> there when it reopens. Re-run it any time with `npm run verify:chrome`. What that
> does and does not cover is under [What has been verified](#what-has-been-verified).

## There is only one copy of the source

Every component, style, database module and service is imported from `../src`. This
directory contains no duplicate of the application:

| File                           | Why Chrome needs it                                        |
| ------------------------------ | ---------------------------------------------------------- |
| `public/manifest.json`         | `action.default_popup` and a service worker, not a sidebar |
| `popup.html`                   | The toolbar popup document                                 |
| `index.html`                   | The full-page tab, opened as `index.html?view=page`        |
| `src/entry.tsx`                | Installs the teardown handoff, then mounts the shared app  |
| `src/teardownHandoff.ts`       | Sends unwritten patches to the service worker              |
| `src/serviceWorker.ts`         | Receives them and writes to IndexedDB                      |
| `src/messages.ts`              | The one message format, and its validation                 |
| `vite.config.ts`               | Builds the UI from `../src` into `dist/`                   |
| `vite.serviceworker.config.ts` | Builds the worker as a self-contained classic script       |

A fix to shared code reaches both browsers with no porting step: rebuild and it is
there. `npm run check` builds this target too, so a Firefox change that breaks
Chrome fails immediately rather than quietly.

## Build and load

```bash
npm install          # from the repository root, once
npm run build:chrome # -> chrome_version/dist/
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select `chrome_version/dist`

The toolbar button opens the popup. **Full page** opens the same notes in a tab.

To produce a Chrome Web Store upload:

```bash
npm run package:chrome  # -> chrome_version/web-ext-artifacts/noutieren-<version>-chrome.zip
```

## How this differs from the Firefox build

**A popup, not a sidebar.** Chrome has no sidebar API that matches Firefox's, so
the toolbar button opens a popup, capped by Chrome at 800×600. The app declares
exactly that size. The layout is chosen by a CSS container query on width, so at
800 px it shows the same two-pane arrangement a wide Firefox sidebar does — no
separate stylesheet, and no Chrome-specific components.

**A service worker, not an event page.** Firefox MV3 uses `background.scripts`;
Chrome requires `background.service_worker`. The Firefox script exists only to
open the sidebar on click, which Chrome does itself via `default_popup` — so the
worker does something else entirely, below.

**No Gecko keys.** `browser_specific_settings` (the extension id,
`strict_min_version`, `data_collection_permissions`) is Firefox-only and is
omitted here. `minimum_chrome_version` is `111`, set by `color-mix()` in the
stylesheet, the newest CSS feature the app uses.

**Same guarantees.** Two permissions (`storage`, `unlimitedStorage`), no host
permissions, no content scripts, no network access, the same strict CSP. The build
is audited by the same script as Firefox: `node scripts/verify-build.mjs --target=chrome`.

## Why a service worker writes your notes

This is the one piece of real engineering in the port, so it is worth knowing about.

Autosave debounces for 400 ms. In a Firefox sidebar or any browser tab that is
fine: `pagehide` fires, the pending patch is written, and the document survives
long enough for the `await` to finish.

A Chrome popup does not work that way. The moment it loses focus its document is
destroyed, and an IndexedDB transaction opened microseconds earlier dies with the
connection that owns it. Starting a write there is not slow — it is _unreliable_,
which is a worse property for a save path to have.

So on teardown the popup does not write. It takes its queued patches out of the
save queue and posts them to the service worker, which has its own lifetime and
its own connection to the same database. `sendMessage` hands the payload to the
browser process synchronously, so delivery stops depending on a page that is about
to be collected.

The seam is a plain injected function (`src/services/teardown.ts`), so the shared
code carries no Chrome knowledge and no build-time flag, and both branches are
reachable from tests. Firefox installs no handoff and keeps flushing in place.

Details worth knowing:

- Patches already **in flight** are left alone rather than re-sent, because they
  have started and a duplicate would race them. A patch sits in the queue for at
  most one debounce window, so what gets handed over is the last ~400 ms of typing.
- Each write keeps the version it was queued against, so a genuinely concurrent
  edit in another window is still detected. A conflict is counted and dropped: the
  page that could have offered you a choice no longer exists, and the newer data
  already in storage is the better answer.
- Notes are written independently, so one failure never blocks the others.

Covered by `tests/teardownHandoff.test.tsx` (which branch runs, and that it does
not also write in place), `tests/chromePlatform.test.ts` (snapshot semantics,
message validation, the worker's write behaviour), and end to end in a real browser
by `npm run verify:chrome`.

## Chrome refuses persistent storage; `unlimitedStorage` covers it

Version 1.2.0 asks for eviction-exempt storage at startup via
`navigator.storage.persist()`. Firefox grants that to an extension without
prompting. **Chrome refuses it outright** for extension origins, even holding
`unlimitedStorage` — measured on Chromium 150, where `persist()` returns `false`
and `persisted()` stays `false` while the quota is lifted to about 32 GB.

So on Chrome the permission governs eviction and this call is simply not wired to
it. The app treats the refusal as the browser policy it is: one `console.warn` line
at startup, not an error. It used to log an error, which on Chrome would have
appeared on every single launch and claimed your data "may be evicted" — misleading
about the thing that actually protects it.

Backups still matter, for the reason they always did: a browser profile is one
disk, in one place.

## Your notes do not move between browsers

Chrome and Firefox are separate browsers with separate storage. Notes written in
one are invisible to the other — there is no sync, by design. Use
**Settings → Export** and **Import** to move them across.

## What has been verified

```bash
npm run verify:chrome
```

That builds the extension, loads it into a headless Chromium under a throwaway
profile, and drives it over the DevTools protocol. Eighteen checks, all passing on
Chromium 150:

- The **manifest and CSP are accepted** and the service worker registers. This was
  the biggest open question — Chrome is stricter than Firefox about
  `content_security_policy.extension_pages` — and the answer is that the strict
  policy is taken as-is, with no CSP violations reported at runtime.
- The popup **renders the app and its editor**, declares 800×600, and gets the
  two-pane layout (measured: `290px 509px`).
- **No errors on startup.**
- **Text typed immediately before the popup is destroyed survives.** The check
  types into the real editor, confirms storage is still empty, destroys the
  document inside the 400 ms debounce window, then reopens and finds the text —
  in the note row, in the stored document, and displayed back in the editor.
- The worker **persists a handoff**, **refuses a stale write** rather than
  clobbering a newer edit, and **reports a deleted note as failed** instead of
  throwing.
- The **full-page view** renders, is not forced to popup dimensions, and shows the
  same note the popup edits.

Separately confirmed by intercepting `chrome.runtime.sendMessage`: nothing is sent
while you type, and exactly one `noutieren/flush-pending` message goes out during
teardown carrying the text, the document and a numeric base version. So the
handoff is what saves the text — not a debounce that happened to fire in time.

**What this cannot cover.** Headless Chromium has no browser UI, so the popup
document is driven as a page with an 800×600 viewport. Chrome derives the real
popup window size from the document's declared size, which _is_ verified, but the
window it actually draws from the toolbar button deserves one human look — along
with the usual things automation is bad at judging: theme switching, focus rings,
and whether it feels right.

## Before publishing to the Chrome Web Store

**The extension id determines where your notes live**, exactly as
`browser_specific_settings.gecko.id` does on Firefox — and this manifest does not
declare one. That has two consequences:

- An unpacked extension's id is derived from its **directory path**. Move or rename
  `chrome_version/dist` and Chrome treats it as a different extension with an empty
  database. Your notes are not gone, but that install will not see them.
- The Web Store assigns its own id on first upload. Notes written while testing
  unpacked will therefore **not** appear in the published version.

Neither matters while you are just trying it out. Both matter the moment you have
notes you care about. Export a backup before switching between an unpacked and a
published install. Pinning the id ahead of time is possible via a manifest `key`,
and is worth doing before a first upload rather than after.

Also note the Web Store charges a one-time developer registration fee, and reviews
take longer than addons.mozilla.org. As on AMO, the bundle is minified, so expect
to point reviewers at [`../BUILDING.md`](../BUILDING.md).
