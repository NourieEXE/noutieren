# Permission copy

Ready-to-paste text explaining what Noutieren asks for and why. Kept here so the
wording stays reviewable alongside the code — edit here, then paste into the
Developer Hub or the Web Store dashboard.

Three permissions exist. Two are requested at install; `tabs` is optional and is
requested at runtime, only if someone uses _Pin to URL_.

| Permission         | When            | Why                                         |
| ------------------ | --------------- | ------------------------------------------- |
| `storage`          | Install         | Save notes and interface preferences        |
| `unlimitedStorage` | Install         | Do not cap notes at the small default quota |
| `tabs`             | Optional, later | Read the current tab's address, for pins    |

---

## Short version, for a listing description

```
WHY IT ASKS FOR TAB ACCESS

Only if you use "Pin to URL", and it asks the first time you turn it on.

Pinning lets you say "show this tab only while I'm on YouTube". To do that,
Noutieren has to know which page you're currently on — that's the address of the
tab you're viewing, and nothing more.

• It is never requested at install, and never on update.
• If you never pin anything, you are never asked, and nothing changes.
• The address is compared against the patterns you typed, in memory, and then
  forgotten. It is never saved, never included in a backup, and never sent
  anywhere — the extension has no network code at all.
• Noutieren still cannot read the CONTENT of any page. It sees the address of the
  tab, not what is on it.
• You can say no. Your pins stay saved and simply do nothing until you change your
  mind.
• You can withdraw it at any time, and nothing is lost — everything you pinned
  becomes visible again.
```

## One-liner, where space is tight

```
Optional. Only used by "Pin to URL", to tell which page you're on so pinned notes
can appear. The address is checked in memory and never stored or sent. Never
requested unless you use the feature.
```

---

## Chrome Web Store — Privacy practices tab

Each field below is required before a version using `tabs` can be published. Paste
them verbatim.

### Single purpose description

```
Noutieren is a note-taking extension. It keeps rich-text notes organised into
color-labeled tabs, stored locally in the browser, available from the toolbar
popup or a full browser tab.
```

### Justification — `tabs`

```
Used only by the optional "Pin to URL" feature, which lets a user show a notes tab
or an individual note only while a particular website is open — for example, notes
that appear on YouTube and stay hidden elsewhere.

To decide whether a pin matches, the extension reads the URL of the active tab and
compares it, in memory, against match patterns the user typed themselves. The URL
is not stored, not written to the database, not included in exported backups, and
not transmitted — the extension makes no network requests of any kind and its CSP
sets connect-src 'none'.

This permission is declared in optional_permissions, not permissions. It is never
requested at install or on update. It is requested at runtime, from a button the
user presses, and only after they have created a pin. Users who never use the
feature are never asked and are unaffected. Declining is fully supported: the pins
remain saved and simply have no effect. Revoking the permission later restores full
visibility with no data loss.

Only the tab URL is read. No host permissions and no content scripts are requested,
so the extension cannot access page content.
```

### Justification — `storage`

```
Stores the user's notes, tabs and interface preferences (selected tab and note,
theme, panel state) locally in the browser. This is the extension's core function.
Nothing is transmitted.
```

### Justification — `unlimitedStorage`

```
Notes are user-authored documents with no practical size limit. The default
extension storage quota is small enough that a heavy user would hit it and lose
the ability to save. This permission also exempts the data from eviction under
storage pressure, which matters because the notes exist only on this device.
```

### Data usage — what to certify

Tick **none** of the data-collection categories. Then certify all three statements:

- I do not sell or transfer user data to third parties, outside of approved use cases
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

The tab URL is read transiently and never leaves the device, so it is not collected
under the Web Store's definition. If a reviewer asks, the answer is the paragraph
above plus [`PRIVACY.md`](../PRIVACY.md).

---

## addons.mozilla.org

Firefox shows the optional permission in its own prompt at the moment it is
requested, so nothing extra is required at submission. `data_collection_permissions`
stays `{ required: ["none"] }` — that field describes data **collected or
transmitted**, and reading an address into memory to compare it locally is neither.

If a reviewer asks why an add-on with "no network access" wants `tabs`, the Chrome
justification above answers it unchanged.

---

## If a reviewer pushes back

The three facts that resolve it, in order of usefulness:

1. **It is optional.** `optional_permissions`, not `permissions`. Grep the manifest.
   No existing user is prompted or disabled on update.
2. **It is requested from a user gesture, after a pin exists.** Not on install, not
   on startup, not on first run.
3. **Nothing leaves the device.** There is no network code. `scripts/verify-build.mjs`
   fails the build on any remote reference, and the CSP sets `connect-src 'none'`.
   Both are checkable in the source archive.
