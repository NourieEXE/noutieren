import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Builds the Chrome extension UI from the shared `../src` tree.
 *
 * `root` is this directory so the HTML entries and `public/` resolve here and
 * the output lands in `chrome_version/dist`, but every component, style and
 * service is imported from `../src`. There is no second copy of the
 * application: this directory holds only what Chrome needs differently.
 *
 * Two HTML entries, both loading the same script — `popup.html` for the toolbar
 * popup and `index.html` for the full-page tab, which the shared
 * `openFullPageEditor` opens as `index.html?view=page`.
 *
 * The remaining options mirror `../vite.config.ts`: relative `base` so assets
 * resolve from a `chrome-extension://` origin, no source maps or inlined assets
 * in the shipped package, and no module-preload polyfill so no `fetch` call
 * reaches the bundle.
 */
export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  server: {
    // `npm run dev:chrome` serves files from outside this root.
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Matches `minimum_chrome_version` in the manifest, which is set by the
    // oldest Chrome supporting `color-mix()` — see chrome_version/README.md.
    target: 'chrome111',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
});
