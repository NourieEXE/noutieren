import { mount } from './mount';

/**
 * Firefox entry point, loaded by `index.html` for both the sidebar and the
 * full-page tab.
 *
 * Nothing to install first: a Firefox sidebar survives long enough after
 * `pagehide` to finish its own autosave, so the default in-page flush is
 * correct here. Chrome's entry point is `chrome_version/src/entry.tsx`.
 */
mount();
