# addons.mozilla.org listing copy

> **Submitted and approved.** Live at
> <https://addons.mozilla.org/en-US/firefox/addon/noutieren-notes/> as _Noutieren (Notes)_,
> version 1.3.0. This file is kept as the source for the listing text — edit it here, then
> paste into the Developer Hub, so the wording stays reviewable alongside the code.
>
> Permission wording lives in [`permissions.md`](permissions.md).

---

## Name

```
Noutieren
```

## Summary (max 250 characters)

```
Private notes in your Firefox sidebar, organised into color-labeled tabs. Rich text, instant
search, and JSON backups. Everything stays on your device: no account, no sync, no telemetry,
and no network requests at all.
```

## Description

```
Noutieren keeps formatted notes in the Firefox sidebar, organised into tabs you can name and
colour however you like. It opens in a full browser tab when you want more room, working on
the same notes.

ORGANISATION
• Unlimited color-labeled tabs, each renameable, recolourable and reorderable
• Unlimited notes per tab, each with its own title and colour
• Move notes between tabs, duplicate them, reorder them
• Instant search across the current tab or every tab at once

PIN TO URL
• Show a tab, or a single note, only while a particular page is open
• Pin to one exact address, a whole site, or everything under a path
• Patterns like https://*.youtube.com/* — the same syntax browsers use themselves
• Anything hidden is one click away, and never deleted
• Optional: needs your permission, and only if you use it (see below)

WRITING
• Bold, italic, underline, strikethrough
• Headings, bulleted lists, numbered lists and checklists
• Block quotes, inline code, code blocks and links
• Undo, redo and clear formatting, with familiar keyboard shortcuts
• Everything saves automatically as you type

YOUR DATA STAYS YOURS
• No account, no sign-in, no cloud sync, no telemetry, no ads
• No network requests of any kind — the extension cannot phone home
• No content scripts and no host permissions: it cannot read the pages you browse
• Two permissions at install: storage, and unlimitedStorage so notes aren't capped
• Export everything to a readable JSON file at any time, and import it back

WHY IT ASKS FOR TAB ACCESS

Only if you use "Pin to URL", and it asks the first time you turn it on.

Pinning lets you say "show this tab only while I'm on YouTube". To do that,
Noutieren has to know which page you're currently on — that's the address of the
tab you're viewing, and nothing more.

• It is never requested at install, and never on update
• If you never pin anything, you are never asked, and nothing changes
• The address is compared against the patterns you typed, in memory, and then
  forgotten — never saved, never in a backup, never sent anywhere
• Noutieren still cannot read the CONTENT of any page, only the tab's address
• You can say no: your pins stay saved and simply do nothing until you change
  your mind
• You can withdraw it at any time, and nothing is lost

ALSO
• Light, dark and system themes
• Full keyboard navigation and screen-reader support
• Works from a narrow sidebar to a full window

Because your notes live only in this Firefox profile, Noutieren reminds you to export a
backup if it has been a while. Open source, MIT licensed:
https://github.com/NourieEXE/noutieren
```

## Category

Primary: **Productivity**. (AMO asks for one or two; "Photos, Music & Videos" and similar are
clearly wrong, and there is no dedicated Notes category.)

## Tags

`notes`, `notepad`, `sidebar`, `privacy`, `offline`, `local`, `productivity`

## Support

| Field         | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| Support site  | `https://github.com/NourieEXE/noutieren`                         |
| Support email | Optional. Leave blank to route everything through GitHub issues. |
| Homepage      | `https://github.com/NourieEXE/noutieren`                         |

## Privacy policy

Paste the contents of [`PRIVACY.md`](../PRIVACY.md), or link to it on GitHub. AMO asks for
policy text rather than only a link, so pasting is safer.

## Data collection disclosure

Answer **"Does not collect any data."** This matches the manifest, which declares
`data_collection_permissions: { required: ["none"] }`.

## Screenshots

Upload from `docs/`:

1. `noutieren.png` — the sidebar in use (lead image)
2. `tab_settings.png` — tab naming, the colour palette, reordering
3. `note_settings.png` — the note actions menu

AMO accepts up to 10 and displays them at up to 1280×800. The captures are portrait
sidebar-shaped, which is honest about what the extension is.

## Version notes for 1.3.0

```
NEW: Pin to URL

Show a tab, or a single note, only while a particular page is open — notes that
appear on YouTube and stay out of the way everywhere else.

• Pin to one exact address, a whole site, or everything under a path
• Patterns like https://*.youtube.com/* — the syntax browsers use themselves
• What you type is what is saved: no wildcard is ever added for you
• Anything hidden is one click away from the tab strip, and never deleted

Pinning needs permission to see the address of the tab you are on. It is optional
and off by default: never requested at install or on update, only when you press
"Enable Pin to URL" after making your first pin. Saying no keeps your pins saved
and simply inactive. The address is checked in memory and never stored or sent —
there is still no network code in this extension at all.
```

## Version notes for 1.2.0

```
• Requests eviction-exempt storage so notes survive disk pressure
• Reminds you to export a backup when the last one has gone stale
• Shows how long ago you last backed up, in the settings menu
```

## Source code submission

The uploaded build is minified, so AMO requires source. Point the reviewer at this repository
and at [`BUILDING.md`](../BUILDING.md), which gives the exact toolchain and the two commands
(`npm ci && npm run build`) that reproduce `dist/` byte for byte, plus a digest comparison to
prove it.

If AMO wants an archive rather than a URL, `git archive --format=zip -o source.zip HEAD`
produces one from a clean checkout.
