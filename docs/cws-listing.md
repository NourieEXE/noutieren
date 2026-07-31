# Chrome Web Store listing copy

A spare description, kept in case the one already in the Developer Dashboard needs
replacing. The dashboard is the source of truth for what is live; this file is just
somewhere the wording can be reviewed and edited alongside the code.

The submitted description is the addons.mozilla.org copy from
[`amo-listing.md`](amo-listing.md) with the Firefox wording corrected. The version
below is a different approach rather than a rewrite of it: it opens with the reason
someone would want the extension, then lists what it does.

---

## Alternative detailed description

```
Somewhere to put a thought without opening a document, making an account, or
sending it to anybody.

Noutieren lives in your toolbar. Click it and your notes are there, sorted into
tabs you name and colour yourself. Click "Full page" when you want the whole
window instead. It saves as you type, and it never talks to the internet.

ORGANISE
• Unlimited color-labeled tabs — rename, recolour and reorder them freely
• Unlimited notes in every tab, each with its own title and colour
• Move notes between tabs, duplicate them, reorder them
• Search titles and text in the current tab, or across every tab at once

WRITE
• Bold, italic, underline, strikethrough
• Headings, bulleted lists, numbered lists and checklists
• Block quotes, inline code, code blocks and links
• Undo, redo, clear formatting, and the keyboard shortcuts you already expect
• Saves automatically — there is no save button to forget

YOUR NOTES ARE YOURS
• No account and no sign-in
• No cloud sync, no telemetry, no analytics, no ads
• No network requests of any kind — the extension cannot phone home
• No content scripts and no host permissions, so it cannot read the pages you visit
• Two permissions only: storage, and unlimitedStorage so your notes are never capped
• Export everything to a plain, readable JSON file at any time, and import it back

ALSO
• Light, dark and system themes
• Full keyboard navigation and screen-reader support
• Comfortable in the popup, and roomy in a full tab

Because your notes live in this browser profile and nowhere else, Noutieren
reminds you to export a backup when it has been a while.

Open source, MIT licensed: https://github.com/NourieEXE/noutieren
```

## Alternative short descriptions

This is the `description` field in `chrome_version/public/manifest.json`, and it is
what appears under the name in store search results. **Chrome rejects anything over
132 characters.** Counts verified:

| Chars | Text                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 120   | `Private, local-first notes organized into color-labeled tabs. Rich text, instant search, no accounts, no network access.` — **current** |
| 122   | `Private notes in a popup, organised into color-labeled tabs. Rich text, instant search, no accounts and no network access.`             |
| 115   | `Notes in your toolbar, organised into color-labeled tabs. Rich text and instant search, stored only on your device.`                    |
| 130   | `Formatted notes one click away, sorted into color-labeled tabs. Everything stays on your device: no account, no sync, no tracking.`     |

Changing this one means editing the manifest and rebuilding, so it also needs a
version bump before the next upload — unlike the detailed description, which is
edited in the dashboard alone.

## Notes on wording

- **Never say "sidebar" or "Firefox."** Chrome has no sidebar here; the toolbar
  button opens a popup. This is the single easiest way for the listing to look
  careless to a reviewer.
- **Do not claim eviction-exempt storage.** Chrome refuses
  `navigator.storage.persist()` for extension origins, so `unlimitedStorage` is
  what protects the notes there. "Never capped" is accurate; "never evicted" is
  not. See _Chrome refuses persistent storage_ in
  [`../chrome_version/README.md`](../chrome_version/README.md).
- **British or American spelling, but pick one.** The copy above uses "colour" in
  prose and "color-labeled" as the product term, matching the Firefox listing.
