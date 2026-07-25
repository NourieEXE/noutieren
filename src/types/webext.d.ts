import type * as WebExtension from 'webextension-polyfill';

declare global {
  /**
   * Firefox exposes the promise-based `browser` namespace natively on extension
   * pages, so no runtime polyfill is bundled. Typed as possibly undefined
   * because the same code also runs under `vite dev` and in unit tests, where
   * the namespace does not exist.
   */
  const browser: WebExtension.Browser | undefined;
}

export {};
