#!/usr/bin/env node
/**
 * Captures the Chrome Web Store screenshots from the real running extension.
 *
 * The store requires images at exactly 1280x800, but a Chrome popup is only
 * 800x600 — so the popup is photographed at its true size and composited into a
 * mock browser window, anchored under a lit toolbar icon. That is what clicking
 * the button actually looks like, and it fills the frame without stretching the
 * interface or faking a single pixel of it.
 *
 * Chromium does the compositing itself: the popup screenshot is written to disk,
 * referenced from a small HTML page, and that page is photographed at 1280x800.
 * No image library, and the app pixels are never resampled.
 *
 * Usage: `npm run images:chrome` (builds first), or
 *        `node scripts/capture-store-images.mjs` against an existing build.
 *        Set `CHROME=/path/to/binary` to choose a browser.
 *
 * Output: docs/store/chrome-*.png
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'chrome_version', 'dist');
const OUT = join(ROOT, 'docs', 'store');

const CANDIDATES = [
  process.env.CHROME,
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
].filter(Boolean);

/* ----------------------------------------------------------- demo workspace */

/** Palette values taken from src/utils/colors.ts, so nothing is invented. */
const INDIGO = '#4f46e5';
const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const SKY = '#0ea5e9';
const PINK = '#ec4899';

const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const h = (level, text) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
const bullets = (items) => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
});
const tasks = (items) => ({
  type: 'taskList',
  content: items.map(([checked, t]) => ({
    type: 'taskItem',
    attrs: { checked },
    content: [p(t)],
  })),
});
const doc = (...nodes) => ({ type: 'doc', content: nodes });

/**
 * Deliberately ordinary content. A store screenshot is read in two seconds, so
 * it has to look like somebody's actual notes rather than lorem ipsum, and it
 * must show the formatting off without becoming a demo of formatting.
 */
const WORKSPACE = [
  {
    title: 'Work',
    color: INDIGO,
    notes: [
      {
        title: 'Meeting notes',
        color: INDIGO,
        content: doc(
          h(2, 'Planning, Tuesday'),
          p('Went through the roadmap and agreed to cut the reporting work for now.'),
          tasks([
            [true, 'Write up the storage decision'],
            [false, 'Ask Dana about the contractor budget'],
            [false, 'Book a room for the retro'],
          ]),
          h(3, 'Open questions'),
          bullets([
            'Does the import need to handle the old export format?',
            'Who owns the migration once it ships?',
          ]),
          {
            type: 'blockquote',
            content: [p('Decision: ship the smaller version first and measure.')],
          },
          p('Next check-in is the 14th.'),
        ),
      },
      {
        title: 'Roadmap Q3',
        color: SKY,
        content: doc(
          h(2, 'Shipping this quarter'),
          bullets(['Offline editing', 'Faster search over long notes', 'Keyboard shortcuts']),
          p('Everything else moves to Q4.'),
        ),
      },
      { title: 'Onboarding checklist', color: GREEN, content: doc(p('Laptop, accounts, buddy.')) },
    ],
  },
  {
    title: 'Personal',
    color: GREEN,
    notes: [
      {
        title: 'Groceries',
        color: GREEN,
        content: doc(
          tasks([
            [false, 'Coffee'],
            [false, 'Olive oil'],
            [true, 'Bread'],
          ]),
        ),
      },
      { title: 'Book list', color: AMBER, content: doc(bullets(['Piranesi', 'The Dispossessed'])) },
      { title: 'Trip plan', color: SKY, content: doc(p('Train on the 3rd, back on the 9th.')) },
    ],
  },
  {
    title: 'Ideas',
    color: AMBER,
    notes: [
      {
        title: 'Side project',
        color: AMBER,
        content: doc(p('A tiny tool for reading changelogs.')),
      },
      {
        title: 'Blog drafts',
        color: PINK,
        content: doc(p('Why local-first is worth the trouble.')),
      },
    ],
  },
];

/* ------------------------------------------------------------- CDP plumbing */

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed')), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return {
    close: () => ws.close(),
    async open(url, width, height) {
      // No size here: headless refuses it ("Target position can only be set for
      // new windows"). The emulation override below is what actually sets it.
      const { targetId } = await send('Target.createTarget', { url });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Runtime.enable', {}, sessionId);
      await send('Page.enable', {}, sessionId);
      // The sessionId matters: without it this goes to the browser session,
      // which has no Emulation domain and reports the method as missing.
      await send(
        'Emulation.setDeviceMetricsOverride',
        {
          width,
          height,
          // Exactly 1, for two reasons: the store demands precisely 1280x800,
          // and at 1:1 the popup's pixels land in the composite untouched. Any
          // scale factor would mean resampling the interface twice.
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      );
      return {
        cmd: (method, params) => send(method, params, sessionId),
        async eval(expression) {
          const r = await send(
            'Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true },
            sessionId,
          );
          if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          }
          return r.result.value;
        },
        async shoot(file) {
          const { data } = await send(
            'Page.captureScreenshot',
            { format: 'png', captureBeyondViewport: false },
            sessionId,
          );
          writeFileSync(file, Buffer.from(data, 'base64'));
        },
        close: () => send('Target.closeTarget', { targetId }),
      };
    },
  };
}

function until(fn, { timeout = 15000, interval = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  return (async () => {
    while (Date.now() < deadline) {
      try {
        const v = await fn();
        if (v) return v;
      } catch {
        // Extension pages take a moment to become evaluable.
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  })();
}

const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------ the browser mock-up */

/**
 * A restrained browser window. It exists to give the popup somewhere to hang
 * from, so it stays plainly a frame: no fake URL worth reading, no invented
 * branding, and the extension's own icon in the toolbar where the real one sits.
 */
function framePage({ shot, width, height, theme, iconDataUri, anchorRight, tab }) {
  const dark = theme === 'dark';
  const c = dark
    ? {
        page: 'linear-gradient(160deg,#1b2330,#0d1117)',
        chrome: '#20262e',
        chromeEdge: '#2c333d',
        tabBar: '#161b22',
        tab: '#20262e',
        omni: '#161b22',
        omniText: '#6e7681',
        content: '#0d1117',
        dot: '#39414d',
        icon: 'rgba(255,255,255,.10)',
      }
    : {
        page: 'linear-gradient(160deg,#e9edf3,#dbe2ec)',
        chrome: '#dee3ea',
        chromeEdge: '#c9d1db',
        tabBar: '#cfd6e0',
        tab: '#f4f6f9',
        omni: '#ffffff',
        omniText: '#8b95a5',
        content: '#f7f8fa',
        dot: '#b6bfcc',
        icon: 'rgba(15,23,42,.08)',
      };

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${width}px;height:${height}px;overflow:hidden}
  body{background:${c.page};display:grid;place-items:center;
       font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
  .win{width:${width - 96}px;height:${height - 76}px;border-radius:12px;overflow:hidden;
       background:${c.content};box-shadow:0 24px 60px rgba(15,23,42,${dark ? '.55' : '.22'}),
       0 2px 6px rgba(15,23,42,${dark ? '.4' : '.10'});position:relative;
       border:1px solid ${c.chromeEdge}}
  .tabbar{height:38px;background:${c.tabBar};display:flex;align-items:flex-end;padding:0 10px;gap:8px}
  .dots{display:flex;gap:6px;align-items:center;height:38px;padding-right:6px}
  .dots i{width:11px;height:11px;border-radius:50%;background:${c.dot};display:block}
  .tab{height:29px;min-width:190px;background:${c.tab};border-radius:8px 8px 0 0;
       display:flex;align-items:center;gap:8px;padding:0 12px;font-size:12px;
       color:${dark ? '#c9d1d9' : '#3d4757'}}
  .tab img{width:14px;height:14px;border-radius:3px}
  .bar{height:44px;background:${c.chrome};display:flex;align-items:center;gap:10px;padding:0 12px;
       border-bottom:1px solid ${c.chromeEdge}}
  .nav{display:flex;gap:12px;color:${c.omniText};font-size:14px;user-select:none}
  .omni{flex:1;height:28px;border-radius:14px;background:${c.omni};display:flex;align-items:center;
        padding:0 14px;font-size:12px;color:${c.omniText};
        border:1px solid ${dark ? '#2c333d' : '#dfe5ec'}}
  .acts{display:flex;align-items:center;gap:4px}
  .puz{width:26px;height:26px;border-radius:6px;display:grid;place-items:center;
       color:${c.omniText};font-size:13px}
  .lit{width:28px;height:28px;border-radius:7px;background:${c.icon};display:grid;place-items:center;
       outline:2px solid ${dark ? 'rgba(126,166,255,.55)' : 'rgba(44,95,212,.35)'};outline-offset:1px}
  .lit img{width:19px;height:19px}
  .page{position:absolute;inset:82px 0 0 0;background:${c.content}}
  .skel{padding:38px 46px;display:flex;flex-direction:column;gap:13px}
  .skel span{display:block;height:11px;border-radius:6px;
             background:${dark ? '#171d26' : '#eceff4'}}
  .pop{position:absolute;top:76px;${anchorRight}px;width:800px;height:600px;border-radius:10px;
       overflow:hidden;box-shadow:0 18px 44px rgba(15,23,42,${dark ? '.6' : '.28'}),
       0 0 0 1px rgba(15,23,42,${dark ? '.5' : '.10'})}
  .pop img{display:block;width:800px;height:600px}
  </style></head><body>
  <div class="win">
    <div class="tabbar">
      <div class="dots"><i></i><i></i><i></i></div>
      <div class="tab">${tab.icon ? `<img src="${iconDataUri}" alt="">` : ''}<span>${tab.title}</span></div>
    </div>
    <div class="bar">
      <div class="nav"><span>&#8592;</span><span>&#8594;</span><span>&#10227;</span></div>
      <div class="omni">Notes stay on this device</div>
      <div class="acts">
        <div class="puz">&#9781;</div>
        <div class="lit"><img src="${iconDataUri}" alt=""></div>
      </div>
    </div>
    <div class="page"><div class="skel">
      <span style="width:38%"></span><span style="width:82%"></span><span style="width:74%"></span>
      <span style="width:86%"></span><span style="width:52%"></span>
    </div></div>
    ${shot ? `<div class="pop"><img src="${shot}" alt=""></div>` : ''}
  </div></body></html>`;
}

/* ------------------------------------------------------------------- driver */

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('chrome_version/dist/ is not built. Run `npm run build:chrome` first.');
  process.exit(1);
}
const binary = CANDIDATES.find(
  (b) => spawn(b, ['--version'], { stdio: 'ignore' }).pid !== undefined,
);
if (!binary) {
  console.error(`No Chrome binary found. Tried: ${CANDIDATES.join(', ')}. Set CHROME=/path.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'noutieren-shots-'));
const profile = join(work, 'profile');
mkdirSync(profile);

const child = spawn(
  binary,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--load-extension=${DIST}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
);
let stderr = '';
child.stderr.on('data', (c) => (stderr += c));

let browser;
function signal(sig) {
  try {
    process.kill(-child.pid, sig);
  } catch {
    // Gone already.
  }
}
async function cleanup() {
  try {
    browser?.close();
  } catch {
    // Already closed.
  }
  signal('SIGTERM');
  await Promise.race([
    new Promise((r) => child.once('exit', r)),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  signal('SIGKILL');
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

try {
  const port = await until(
    () => {
      const f = join(profile, 'DevToolsActivePort');
      return existsSync(f) ? readFileSync(f, 'utf8').split('\n')[0].trim() : null;
    },
    { label: 'the browser to start' },
  );
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser = await connect(version.webSocketDebuggerUrl);

  const target = await until(
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return list.find((t) => t.url.includes('service-worker.js')) ?? null;
    },
    { label: 'the extension to load' },
  );
  const id = target.url.split('/')[2];
  console.log(`\nCapturing store images from ${version.Browser}`);
  console.log('-'.repeat(56));

  const iconDataUri = `data:image/png;base64,${readFileSync(join(DIST, 'icons', 'icon-128.png')).toString('base64')}`;

  /* -- seed the workspace ------------------------------------------------- */

  const seeder = await browser.open(`chrome-extension://${id}/popup.html`, 800, 600);
  await until(() => seeder.eval(`!!document.querySelector('.ProseMirror')`), {
    label: 'the app to create its database',
  });

  const selection = await seeder.eval(`(async () => {
    const data = ${JSON.stringify(WORKSPACE)};
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('colornote-tabs');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const run = (stores, fn) => new Promise((res, rej) => {
      const tx = db.transaction(stores, 'readwrite');
      fn(tx); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    await run(['tabs', 'notes', 'contents'], (tx) => {
      tx.objectStore('tabs').clear();
      tx.objectStore('notes').clear();
      tx.objectStore('contents').clear();
    });

    // Ages the rows so "edited 2 hours ago" style labels look lived-in rather
    // than showing every note created in the same millisecond.
    let clock = Date.now() - 1000 * 60 * 60 * 26;
    const tick = () => (clock += 1000 * 60 * 37);
    let firstTab = null, firstNote = null;
    await run(['tabs', 'notes', 'contents'], (tx) => {
      const T = tx.objectStore('tabs'), N = tx.objectStore('notes'), C = tx.objectStore('contents');
      data.forEach((tab, ti) => {
        const tabId = crypto.randomUUID();
        if (ti === 0) firstTab = tabId;
        const t = tick();
        T.put({ id: tabId, title: tab.title, color: tab.color, position: ti, createdAt: t, updatedAt: t });
        tab.notes.forEach((note, ni) => {
          const noteId = crypto.randomUUID();
          if (ti === 0 && ni === 0) firstNote = noteId;
          const n = tick();
          const plain = JSON.stringify(note.content).match(/"text":"(.*?)"/)?.[1] ?? '';
          N.put({ id: noteId, tabId, title: note.title, color: note.color, position: ni,
                  plainText: plain, createdAt: n, updatedAt: n });
          C.put({ noteId, content: note.content });
        });
      });
    });
    db.close();
    return { tabId: firstTab, noteId: firstNote };
  })()`);

  const setPrefs = (theme) => `chrome.storage.local.set({ preferences: {
    selectedTabId: ${JSON.stringify(selection.tabId)},
    selectedNoteId: ${JSON.stringify(selection.noteId)},
    notesPanelCollapsed: false, theme: ${JSON.stringify(theme)},
    searchAllTabs: false, lastExportedAt: ${Date.now()} } })`;
  await seeder.eval(setPrefs('light'));
  await seeder.close();

  /* -- shoot ------------------------------------------------------------- */

  /** Photographs the popup, then composites it into the browser frame. */
  async function popupShot(name, { theme = 'light', anchorRight = 22, prepare } = {}) {
    const page = await browser.open(`chrome-extension://${id}/popup.html`, 800, 600);
    await until(() => page.eval(`!!document.querySelector('.ProseMirror')`), { label: name });
    await settle(700);
    if (prepare) {
      await page.eval(prepare);
      await settle(650);
    }
    const raw = join(work, `${name}-popup.png`);
    await page.shoot(raw);
    await page.close();

    const html = join(work, `${name}.html`);
    writeFileSync(
      html,
      framePage({
        shot: `file://${raw}`,
        width: 1280,
        height: 800,
        theme,
        iconDataUri,
        anchorRight: `right:${anchorRight}`,
        // A popup floats over whatever page you were on, so the tab behind it
        // must not claim to be the extension.
        tab: { title: 'New Tab', icon: false },
      }),
    );
    const framed = await browser.open(`file://${html}`, 1280, 800);
    await settle(500);
    const out = join(OUT, `${name}.png`);
    await framed.shoot(out);
    await framed.close();
    console.log(`  ${name}.png`);
  }

  await popupShot('chrome-01-popup');

  await popupShot('chrome-02-tab-colors', {
    prepare: `(() => {
      const b = [...document.querySelectorAll('button')]
        .find((el) => /Settings for tab/.test(el.getAttribute('aria-label') || ''));
      b?.click();
      return true;
    })()`,
  });

  await popupShot('chrome-03-note-actions', {
    prepare: `(() => {
      const b = [...document.querySelectorAll('button')]
        .find((el) => (el.getAttribute('aria-label') || '') === 'Note actions');
      b?.click();
      return true;
    })()`,
  });

  /* Shot 4: the full-page view, in dark, inside the same window chrome. */
  {
    const name = 'chrome-04-full-page-dark';
    const setter = await browser.open(`chrome-extension://${id}/popup.html`, 800, 600);
    await until(() => setter.eval(`!!document.querySelector('.ProseMirror')`), { label: name });
    await setter.eval(setPrefs('dark'));
    await setter.close();

    // The window mock is 1184x724 with an 82px chrome, so the tab's viewport is
    // what the app actually gets. Shooting at that size means no rescaling.
    const inner = { width: 1184, height: 724 - 82 };
    const page = await browser.open(
      `chrome-extension://${id}/index.html?view=page`,
      inner.width,
      inner.height,
    );
    await until(() => page.eval(`!!document.querySelector('.ProseMirror')`), { label: name });
    await settle(800);
    const raw = join(work, `${name}-page.png`);
    await page.shoot(raw);
    await page.close();

    const html = join(work, `${name}.html`);
    writeFileSync(
      html,
      framePage({
        shot: null,
        width: 1280,
        height: 800,
        theme: 'dark',
        iconDataUri,
        anchorRight: 'right:22',
        // Here the extension really is the page, so the tab says so.
        tab: { title: 'Noutieren', icon: true },
      })
        // Drop the placeholder page and put the real capture in its place.
        .replace(
          /<div class="page">[\s\S]*?<\/div><\/div>/,
          `<div class="page"><img src="file://${raw}" style="display:block;width:${inner.width}px;height:${inner.height}px"></div>`,
        ),
    );
    const framed = await browser.open(`file://${html}`, 1280, 800);
    await settle(500);
    await framed.shoot(join(OUT, `${name}.png`));
    await framed.close();
    console.log(`  ${name}.png`);
  }

  console.log(`\nWrote ${4} images to docs/store/ at 1280x800.\n`);
} catch (error) {
  console.error(`\nCapture failed: ${error.message}`);
  if (stderr.trim()) console.error(stderr.trim().slice(0, 400));
  await cleanup();
  process.exit(1);
}

await cleanup();
