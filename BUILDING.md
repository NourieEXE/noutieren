# Reproducing the build

These are the instructions for an addons.mozilla.org reviewer, or anyone who wants to confirm
that the published `.xpi` was built from this source. The shipped JavaScript is bundled and
minified, so this file explains how to regenerate it.

## Environment

|                  |                                                                   |
| ---------------- | ----------------------------------------------------------------- |
| Operating system | Any (developed on Linux)                                          |
| Node.js          | 22 or newer — see `.nvmrc`. The published build used Node 26.5.0. |
| npm              | 10 or newer (npm 12.0.1 was used)                                 |
| Network          | Needed only for `npm ci`                                          |

No global tooling is required; every build dependency is in `package.json`.

## Steps

```bash
npm ci          # exact versions from package-lock.json
npm run build
```

The output is the complete unpacked extension in `dist/`.

`npm run build` performs four steps, in order:

1. `scripts/generate-icons.mjs` draws the toolbar icons and encodes them as PNGs using only
   Node's built-in `zlib`. Nothing is downloaded and no image library is involved.
2. `vite build` bundles the interface (`index.html` + `src/`) into `dist/`.
3. `vite build --config vite.background.config.ts` bundles the background event page into
   `dist/background.js` as a self-contained classic script.
4. `scripts/verify-build.mjs` audits `dist/` and fails the build if anything is missing, if a
   source map is present, or if the output contains a remote reference, an inline script, or
   `eval`-style dynamic code.

`public/manifest.json` and `public/icons/` are copied to `dist/` verbatim by Vite.

## Verifying against a published archive

The bundle filename contains a content hash, so a matching build produces byte-identical
files:

```bash
npm ci && npm run build
unzip -p <published>.xpi 'assets/index-*.js' | sha256sum
sha256sum dist/assets/*.js
```

The two digests should be equal. `.xpi` archives additionally contain a `META-INF/` directory
added by Mozilla's signing service; that is not produced by this build and will not be present
in `dist/`.

## Checks

```bash
npm run check
```

Runs, in order: TypeScript in strict mode, ESLint with type-aware rules plus a Prettier
formatting check, the full test suite, the production build with its audit, and
`web-ext lint`. This must exit zero before any release.

`web-ext lint` reports **0 errors** and 4 `UNSAFE_VAR_ASSIGNMENT` warnings. All four are
`innerHTML` assignments inside bundled third-party code — React's `dangerouslySetInnerHTML`
support and its `<script>` element creation path, ProseMirror's clipboard serialiser, and
Tiptap's stylesheet injector. The last of these never executes: the editor is created with
`injectCSS: false` and the equivalent rules ship as static CSS. None can be removed without
patching the upstream libraries.

## Third-party code

All dependencies are installed from the public npm registry at the versions pinned in
`package-lock.json`. The significant ones in the shipped bundle are React, Tiptap and its
ProseMirror packages, and Dexie. No vendored or modified copies of third-party code are
included in this repository.
