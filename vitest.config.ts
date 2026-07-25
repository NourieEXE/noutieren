import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // jsdom refuses localStorage on an opaque origin, and the preference
    // service falls back to it outside an extension context.
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Each file gets a fresh module registry so the Dexie singleton and the
    // in-memory preference store never leak between test files.
    isolate: true,
  },
});
