import type * as WebExtension from 'webextension-polyfill';

declare global {
  /**
   * Firefox exposes the promise-based `browser` namespace natively on extension
   * pages, so no runtime polyfill is bundled. Typed as possibly undefined
   * because the same code also runs under `vite dev` and in unit tests, where
   * the namespace does not exist.
   */
  const browser: WebExtension.Browser | undefined;

  /**
   * Chrome's equivalent. Every API this extension uses is promise-based under
   * MV3, so the same `Browser` shape describes it and no polyfill is bundled
   * there either.
   *
   * Also possibly undefined, and note that an ordinary web page in Chrome
   * carries an unrelated object under this name — which is why `getBrowserApi`
   * checks `runtime.id` rather than mere existence.
   */
  const chrome: WebExtension.Browser | undefined;
}

export {};
