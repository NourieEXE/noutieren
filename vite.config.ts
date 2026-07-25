import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the extension UI (sidebar + full-page editor share one HTML entry).
 *
 * `base: './'` keeps every asset reference relative so the page works when
 * loaded from a `moz-extension://` origin. Source maps are off so the packaged
 * archive carries no development files.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'firefox140',
    // Keep CSS in its own file rather than injected by JS, and never inline
    // assets as data URIs so the output stays easy to audit.
    assetsInlineLimit: 0,
    // One bundle is correct here: the extension loads from local files, so
    // splitting adds requests without saving anything. React + ProseMirror +
    // Dexie land at ~750 KiB unpacked, which is expected for this stack.
    chunkSizeWarningLimit: 1000,
    // Drop Vite's module-preload polyfill: it exists to `fetch()` preload
    // hrefs, which a single-chunk extension never needs, and keeping it out
    // means no `fetch` call ships at all.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
});
