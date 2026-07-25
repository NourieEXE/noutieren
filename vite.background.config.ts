import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The background script is built separately as a classic IIFE bundle.
 *
 * Firefox's MV3 implementation uses event pages (`background.scripts`) rather
 * than service workers, and a self-contained classic script avoids depending on
 * ES-module background support entirely. It runs after the app build with
 * `emptyOutDir: false` so it lands alongside it in `dist/`.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    target: 'firefox140',
    lib: {
      entry: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'noutierenBackground',
      fileName: () => 'background.js',
    },
  },
});
