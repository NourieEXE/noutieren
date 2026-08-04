#!/usr/bin/env node
/**
 * Loads the built Chrome extension into a real headless Chromium and checks the
 * things a unit test cannot reach.
 *
 * `verify-build.mjs` audits the files; this audits the running extension. The
 * questions it answers are the ones that only a browser can:
 *
 * - Does Chrome accept the manifest and the CSP at all?
 * - Does the popup render, and at the 800x600 it declares?
 * - **Does text typed a moment before the popup is destroyed survive?** This is
 *   the one that matters. It is the failure mode the whole service-worker handoff
 *   exists to prevent, it cannot be reproduced in jsdom, and when it breaks it
 *   breaks silently.
 *
 * Usage: `npm run verify:chrome` (builds first), or
 *        `node scripts/verify-chrome.mjs` against an existing build.
 *        Set `CHROME=/path/to/binary` to choose a browser.
 *
 * Everything runs in a throwaway profile that is deleted afterwards, so the
 * workspace always starts empty and the seeded note is untouched.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'chrome_version', 'dist');

const CANDIDATES = [
  process.env.CHROME,
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'brave',
].filter(Boolean);

/* ------------------------------------------------------------- CDP client */

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('Could not open the DevTools socket.')), {
      once: true,
    });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else {
      for (const listener of listeners) listener(msg);
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return {
    send,
    close: () => ws.close(),
    async openPage(url) {
      const { targetId } = await send('Target.createTarget', { url });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const logs = [];
      listeners.add((msg) => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Runtime.consoleAPICalled') {
          logs.push({
            level: msg.params.type,
            text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
          });
        } else if (msg.method === 'Log.entryAdded') {
          logs.push({ level: msg.params.entry.level, text: msg.params.entry.text });
        } else if (msg.method === 'Runtime.exceptionThrown') {
          logs.push({
            level: 'exception',
            text: msg.params.exceptionDetails.exception?.description ?? 'exception',
          });
        }
      });
      await send('Runtime.enable', {}, sessionId);
      await send('Log.enable', {}, sessionId);
      return {
        logs,
        cmd: (method, params) => send(method, params, sessionId),
        async eval(expression, { awaitPromise = true } = {}) {
          const result = await send(
            'Runtime.evaluate',
            { expression, awaitPromise, returnByValue: true },
            sessionId,
          );
          if (result.exceptionDetails) {
            throw new Error(
              result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
            );
          }
          return result.result.value;
        },
        close: () => send('Target.closeTarget', { targetId }),
      };
    },
  };
}

function until(fn, { timeout = 10000, interval = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  return (async () => {
    while (Date.now() < deadline) {
      try {
        const value = await fn();
        if (value) return value;
      } catch {
        // Keep polling: extension pages take a moment to become evaluable.
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  })();
}

/* ------------------------------------------------ snippets run in the page */

/** Reads a note and its document straight from IndexedDB, bypassing the app. */
const readNote = (id) => `(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('colornote-tabs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const get = (store, key) => new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const note = await get('notes', ${JSON.stringify(id)});
  const row = await get('contents', ${JSON.stringify(id)});
  db.close();
  return { note, text: row?.content?.content?.[0]?.content?.[0]?.text ?? '' };
})()`;

const FIRST_NOTE = `(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('colornote-tabs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const all = await new Promise((res, rej) => {
    const r = db.transaction('notes').objectStore('notes').getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  db.close();
  return all.length ? { id: all[0].id, updatedAt: all[0].updatedAt, plainText: all[0].plainText } : null;
})()`;

/**
 * Adds a tab pinned to a site that is certainly not open.
 *
 * Written straight into IndexedDB rather than through the interface, because
 * the point is to check how the app *reads* a pin it did not just create —
 * including after a reload, which is when a wrongly-applied pin would hide it.
 */
const PIN_A_TAB = `(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('colornote-tabs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tabs = await new Promise((res, rej) => {
    const r = db.transaction('tabs').objectStore('tabs').getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const id = 'verify-pinned-tab';
  const now = Date.now();
  await new Promise((res, rej) => {
    const r = db.transaction('tabs', 'readwrite').objectStore('tabs').put({
      id,
      title: 'Pinned',
      color: '#64748b',
      position: tabs.length,
      createdAt: now,
      updatedAt: now,
      urlPatterns: ['https://*.example.invalid/*'],
    });
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
  db.close();
  return id;
})()`;

/* ---------------------------------------------------------------- harness */

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}    ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('chrome_version/dist/ is not built. Run `npm run build:chrome` first.');
  process.exit(1);
}

const binary = CANDIDATES.find((candidate) => {
  const probe = spawn(candidate, ['--version'], { stdio: 'ignore' });
  return probe.pid !== undefined;
});
if (!binary) {
  console.error(`No Chrome binary found. Tried: ${CANDIDATES.join(', ')}. Set CHROME=/path.`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'noutieren-verify-'));
let browser;
const child = spawn(
  binary,
  [
    '--headless=new',
    // Port 0 lets the browser pick; it writes the real one into the profile.
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--load-extension=${DIST}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  // Its own process group, so the whole browser can be signalled at once. A
  // browser is not one process: signalling only the parent leaves its helpers
  // running, and they go on rewriting the profile directory being deleted.
  { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
);
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));

/** Signals the whole browser group; tolerates it already being gone. */
function signalBrowser(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already exited, or never started.
  }
}

async function cleanup() {
  try {
    browser?.close();
  } catch {
    // Already closed.
  }

  signalBrowser('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  signalBrowser('SIGKILL');

  // Retry: even after exit the last writes can still be landing, and a profile
  // left in /tmp on every run is exactly the kind of litter nobody notices.
  rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

try {
  const port = await until(
    () => {
      const file = join(profile, 'DevToolsActivePort');
      return existsSync(file) ? readFileSync(file, 'utf8').split('\n')[0].trim() : null;
    },
    { label: 'the browser to start' },
  );

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  console.log(`\nVerifying chrome_version/dist in ${version.Browser}`);
  console.log('-'.repeat(56));

  browser = await connect(version.webSocketDebuggerUrl);

  // The extension's own id, learned from its running service worker. That the
  // worker has a target at all means the manifest was accepted.
  const targets = await until(
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return list.find((t) => t.url.includes('service-worker.js')) ?? null;
    },
    { label: 'the service worker to register' },
  ).catch(() => null);

  // Only surface the browser's stderr on failure: it is full of unrelated GPU
  // and DevTools chatter that would drown the report.
  check(
    'manifest and CSP accepted; service worker registered',
    targets !== null,
    targets ? '' : stderr.trim().slice(0, 300),
  );
  if (!targets) throw new Error('The extension did not load.');
  const id = targets.url.split('/')[2];
  const POPUP = `chrome-extension://${id}/popup.html`;

  /* ------------------------------------------------- the popup renders */

  const popup = await browser.openPage(POPUP);
  await popup.cmd('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const rendered = await until(() => popup.eval(`!!document.querySelector('.ProseMirror')`), {
    label: 'the editor to appear',
  }).catch(() => false);
  check('popup renders the app and its editor', rendered === true);

  const size = await popup.eval(
    `(() => { const s = getComputedStyle(document.documentElement); return s.width + ' x ' + s.height; })()`,
  );
  check('popup declares 800px x 600px', size === '800px x 600px', size);

  const columns = await popup.eval(
    `(() => { const w = document.querySelector('.workspace'); return w ? getComputedStyle(w).gridTemplateColumns : ''; })()`,
  );
  check(
    'container query gives the two-pane layout',
    String(columns).split(' ').length === 2,
    String(columns),
  );

  const violations = popup.logs.filter((l) => /Content Security Policy|Refused to/i.test(l.text));
  check('no CSP violations', violations.length === 0, violations.map((l) => l.text).join(' | '));

  const errors = popup.logs.filter((l) => l.level === 'error' || l.level === 'exception');
  check(
    'no errors logged on startup',
    errors.length === 0,
    errors.map((l) => l.text.slice(0, 140)).join(' | '),
  );

  /* --------------- the point of the exercise: dismissal loses nothing */

  const note = await until(() => popup.eval(FIRST_NOTE), { label: 'the seeded note' });
  check('first run seeded an empty note', Boolean(note?.id) && !note.plainText);

  await popup.eval(`(() => { document.querySelector('.ProseMirror').focus(); return true; })()`);
  await popup.cmd('Input.insertText', { text: 'typed then dismissed' });

  const pending = await popup.eval(readNote(note.id));
  check(
    'the text is still unwritten at the moment of dismissal',
    pending?.note?.plainText !== 'typed then dismissed',
    `stored=${JSON.stringify(pending?.note?.plainText)}`,
  );

  // Destroy the document inside the 400 ms debounce window. `location.replace`
  // fires pagehide and tears the page down, which is what dismissing a popup
  // does. Nothing in this page can complete a write from here on.
  await popup.eval(`(() => { location.replace('about:blank'); return true; })()`, {
    awaitPromise: false,
  });
  await new Promise((r) => setTimeout(r, 1200));
  await popup.close();

  const reopened = await browser.openPage(POPUP);
  const recovered = await until(
    async () => {
      const value = await reopened.eval(readNote(note.id));
      return value?.note?.plainText === 'typed then dismissed' ? value : null;
    },
    { label: 'the handed-off text to reach storage', timeout: 8000 },
  ).catch(() => null);
  check('text typed just before dismissal survived', recovered !== null);
  check(
    'the document was stored, not only the preview',
    recovered?.text === 'typed then dismissed',
  );

  const displayed = await until(
    async () =>
      (await reopened.eval(`document.querySelector('.ProseMirror')?.textContent`)) ===
      'typed then dismissed',
    { label: 'the editor to show the recovered text', timeout: 5000 },
  ).catch(() => false);
  check('the reopened popup shows it back to the user', displayed === true);

  /* ------------------------------- the worker's contract, probed directly */

  const current = await reopened.eval(FIRST_NOTE);
  const doc = (text) =>
    `{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ${JSON.stringify(text)} }] }] }`;

  const reply = await reopened.eval(`chrome.runtime.sendMessage({
    type: 'noutieren/flush-pending',
    writes: [{ noteId: ${JSON.stringify(current.id)}, expectedUpdatedAt: ${current.updatedAt},
               patch: { plainText: 'written by the worker', content: ${doc('written by the worker')} } }],
  })`);
  check(
    'service worker answers a handoff',
    reply?.written === 1 && reply?.failed === 0,
    JSON.stringify(reply),
  );
  check(
    'and persisted it',
    (await reopened.eval(readNote(current.id)))?.note?.plainText === 'written by the worker',
  );

  const stale = await reopened.eval(`chrome.runtime.sendMessage({
    type: 'noutieren/flush-pending',
    writes: [{ noteId: ${JSON.stringify(current.id)}, expectedUpdatedAt: 1, patch: { plainText: 'stale' } }],
  })`);
  check(
    'refuses a stale write rather than clobbering a newer edit',
    stale?.written === 0 &&
      stale?.failed === 1 &&
      (await reopened.eval(readNote(current.id)))?.note?.plainText === 'written by the worker',
    JSON.stringify(stale),
  );

  const missing = await reopened.eval(`chrome.runtime.sendMessage({
    type: 'noutieren/flush-pending',
    writes: [{ noteId: 'not-a-real-note', expectedUpdatedAt: null, patch: { plainText: 'x' } }],
  })`);
  check(
    'reports a deleted note as failed instead of throwing',
    missing?.written === 0 && missing?.failed === 1,
  );
  await reopened.close();

  /* ------------------------------------------------- the full-page tab */

  const page = await browser.openPage(`chrome-extension://${id}/index.html?view=page`);
  const pageReady = await until(() => page.eval(`!!document.querySelector('.ProseMirror')`), {
    label: 'the full-page editor',
  }).catch(() => false);
  check('full-page view renders', pageReady === true);
  check(
    'full-page view is not forced to popup dimensions',
    (await page.eval(`getComputedStyle(document.documentElement).width`)) !== '800px',
  );
  check(
    'full-page view shows the same note the popup edits',
    (await until(
      async () =>
        (await page.eval(`document.querySelector('.ProseMirror')?.textContent`)) ===
        'written by the worker',
      { timeout: 5000, label: 'the shared note' },
    ).catch(() => false)) === true,
  );
  /* ---------------------------------------------------------- url pins */

  /*
   * "Pin to URL" in the Chrome build.
   *
   * The permission dialog itself is browser UI and cannot be answered over the
   * DevTools protocol, so what is checked here is everything around it: that
   * `tabs` is declared optional and is genuinely not held on a fresh profile,
   * that the matcher and the visibility rules behave in the real bundle rather
   * than only under jsdom, and that a pin is inert — never inverted — while the
   * permission is absent. Answering the prompt stays a manual step.
   */
  const permissionState = await page.eval(`(async () => ({
    declaredOptional: chrome.runtime.getManifest().optional_permissions ?? [],
    required: chrome.runtime.getManifest().permissions ?? [],
    hasTabs: await chrome.permissions.contains({ permissions: ['tabs'] }),
  }))()`);

  check(
    'tabs is declared optional, not required',
    Array.isArray(permissionState?.declaredOptional) &&
      permissionState.declaredOptional.includes('tabs') &&
      !permissionState.required.includes('tabs'),
    JSON.stringify(permissionState),
  );
  check(
    'required permissions are still only storage and unlimitedStorage',
    JSON.stringify(permissionState?.required) === JSON.stringify(['storage', 'unlimitedStorage']),
    JSON.stringify(permissionState?.required),
  );
  check('a fresh profile does not hold the tabs permission', permissionState?.hasTabs === false);

  // Without the permission the extension must not be able to read a URL. This
  // is the check that would catch the permission silently becoming required.
  const urlLeak = await page.eval(`(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs.map((t) => t.url ?? null);
    } catch (error) { return 'threw'; }
  })()`);
  check(
    'cannot read a tab URL before the permission is granted',
    urlLeak === 'threw' || (Array.isArray(urlLeak) && urlLeak.every((u) => !u)),
    JSON.stringify(urlLeak),
  );

  // A tab pinned to a site that is definitely not open, written straight into
  // IndexedDB. With the permission absent, pins must fail *open* — the tab
  // stays visible — because failing closed is indistinguishable from data loss.
  const pinnedTabId = await page.eval(PIN_A_TAB);
  check('a pinned tab can be written to storage', typeof pinnedTabId === 'string');

  await page.close();

  const afterPin = await browser.openPage(`chrome-extension://${id}/index.html?view=page`);
  const tabCount = await until(
    async () => {
      const n = await afterPin.eval(`document.querySelectorAll('[role="tab"]').length`);
      return Number(n) >= 2 ? Number(n) : null;
    },
    { timeout: 5000, label: 'the pinned tab to appear' },
  ).catch(() => 0);
  check(
    'a pinned tab stays visible while the permission is absent',
    tabCount >= 2,
    `tabs rendered: ${tabCount}`,
  );

  const pinIndicator = await afterPin.eval(
    `!!document.querySelector('[aria-label*="hidden by a URL pin" i]')`,
  );
  check('nothing is reported as hidden when pins cannot apply', pinIndicator === false);
  await afterPin.close();

  /*
   * The hand-off tab.
   *
   * The popup cannot raise the permission dialog, so it opens the full page
   * with `grant=pins`. That tab has to lead with the request — the first
   * version did not, and simply arrived on the editor having asked for
   * nothing, which read as the button doing something random.
   */
  const grant = await browser.openPage(`chrome-extension://${id}/index.html?view=page&grant=pins`);
  const banner = await until(
    () =>
      grant.eval(
        `(() => { const b = document.querySelector('[aria-label="Enable Pin to URL"]');
           return b ? b.textContent : null; })()`,
      ),
    { timeout: 5000, label: 'the grant banner' },
  ).catch(() => null);
  check(
    'a tab opened to grant the permission asks for it',
    typeof banner === 'string' && /Grant access/.test(banner),
    String(banner).slice(0, 120),
  );

  const ordinary = await browser.openPage(`chrome-extension://${id}/index.html?view=page`);
  await until(() => ordinary.eval(`!!document.querySelector('.ProseMirror')`), {
    label: 'the ordinary full page',
  }).catch(() => false);
  check(
    'an ordinary full-page tab does not ask for anything',
    (await ordinary.eval(`!!document.querySelector('[aria-label="Enable Pin to URL"]')`)) === false,
  );
  await ordinary.close();

  // The whole point of moving the log off `console.warn`: this panel is what
  // chrome://extensions shows the user under the heading "Errors".
  const noisy = grant.logs.filter((l) => l.level === 'warning' || l.level === 'warn');
  check(
    'nothing is logged at warn level, which Chrome files under "Errors"',
    noisy.length === 0,
    noisy.map((l) => l.text.slice(0, 100)).join(' | '),
  );

  await grant.close();

  /* ------------------------------------------------------------ report */

  const notes = popup.logs.filter((l) => l.level === 'warning' || l.level === 'warn');
  for (const warning of notes) console.log(`  note    ${warning.text.slice(0, 120)}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  if (failed.length > 0) {
    await cleanup();
    process.exit(1);
  }
} catch (error) {
  console.error(`\nVerification could not complete: ${error.message}`);
  if (stderr.trim()) console.error(stderr.trim().slice(0, 500));
  await cleanup();
  process.exit(1);
}

await cleanup();
