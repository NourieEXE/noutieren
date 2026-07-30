import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the MV3 service worker as a self-contained classic script.
 *
 * A classic IIFE rather than an ES module, so the manifest needs no
 * `"type": "module"` and the worker has no dependency on module support in the
 * worker context. It bundles Dexie and the notes repository, because writing to
 * IndexedDB is its entire job.
 *
 * Runs after the UI build with `emptyOutDir: false` so it lands alongside it.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    target: 'chrome111',
    lib: {
      entry: fileURLToPath(new URL('./src/serviceWorker.ts', import.meta.url)),
      formats: ['iife'],
      name: 'noutierenServiceWorker',
      fileName: () => 'service-worker.js',
    },
  },
});
