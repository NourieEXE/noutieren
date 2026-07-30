#!/usr/bin/env node
/**
 * Audits a built extension directory.
 *
 * Checks that the unpacked extension is complete and, above all, that it is
 * self-contained: no remote scripts, styles, fonts or network calls, no
 * `eval`-style dynamic code, and no source maps or dev files to ship.
 *
 * Usage: `node scripts/verify-build.mjs [--target=firefox|chrome]`
 *
 * The self-containment rules are identical for both targets — that is the point
 * of them. Only the manifest expectations differ, because the two browsers
 * disagree about how an extension presents itself and how background code runs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = {
  firefox: { dist: 'dist', label: 'Firefox' },
  chrome: { dist: join('chrome_version', 'dist'), label: 'Chrome' },
};

const requested = process.argv
  .find((arg) => arg.startsWith('--target='))
  ?.slice('--target='.length);
const target = requested ?? 'firefox';
if (!Object.hasOwn(TARGETS, target)) {
  console.error(`Unknown --target=${target}. Expected one of: ${Object.keys(TARGETS).join(', ')}.`);
  process.exit(2);
}
const DIST = join(ROOT, TARGETS[target].dist);
const DIST_LABEL = `${TARGETS[target].dist}/`;

const errors = [];
const warnings = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files = [];
try {
  files = walk(DIST);
} catch {
  fail(`${DIST_LABEL} does not exist. Run the build first.`);
}

const rel = (file) => relative(DIST, file).split('\\').join('/');

/* ---------------------------------------------------------------- manifest */

let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
} catch (error) {
  fail(`${DIST_LABEL}manifest.json is missing or unreadable (${error.message}).`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3.');
  if (!manifest.action) fail('manifest is missing the toolbar action.');

  if (target === 'firefox') {
    if (!manifest.sidebar_action?.default_panel)
      fail('manifest is missing sidebar_action.default_panel.');
    if (manifest.action?.default_popup) {
      fail(
        'manifest sets action.default_popup, which would stop the toolbar click from opening the sidebar.',
      );
    }
    if (!manifest.background?.scripts?.length) fail('manifest is missing background.scripts.');
    if (!manifest.browser_specific_settings?.gecko?.id)
      fail('manifest is missing the Gecko extension id.');
    if (
      manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required?.[0] !==
      'none'
    ) {
      fail('manifest must declare data_collection_permissions.required = ["none"].');
    }
  } else {
    // Chrome has no sidebar API, so the toolbar click must open the popup —
    // the exact opposite of the Firefox requirement above.
    if (!manifest.action?.default_popup) fail('manifest is missing action.default_popup.');
    if (manifest.sidebar_action)
      fail('manifest declares sidebar_action, which Chrome does not support.');
    if (!manifest.background?.service_worker)
      fail('manifest is missing background.service_worker.');
    if (manifest.background?.scripts)
      fail('manifest declares background.scripts, which MV3 Chrome does not accept.');
    // Gecko-only keys would make Chrome reject the package or warn on load.
    if (manifest.browser_specific_settings)
      fail('manifest declares browser_specific_settings, which is Firefox-only.');
    if (!manifest.minimum_chrome_version)
      warnings.push('manifest does not set minimum_chrome_version.');
  }

  const csp = manifest.content_security_policy?.extension_pages ?? '';
  if (!/script-src 'self'/.test(csp)) fail("extension_pages CSP must contain script-src 'self'.");
  if (/unsafe-eval|unsafe-inline/.test(csp))
    fail('extension_pages CSP must not allow unsafe-eval or unsafe-inline.');

  const permissions = manifest.permissions ?? [];
  const allowed = new Set(['storage', 'unlimitedStorage']);
  for (const permission of permissions) {
    if (!allowed.has(permission)) fail(`unexpected permission requested: ${permission}`);
  }
  if (!permissions.includes('unlimitedStorage')) fail('manifest should request unlimitedStorage.');
  if (manifest.host_permissions?.length) fail('manifest must not request host permissions.');
  if (manifest.content_scripts?.length) fail('manifest must not register content scripts.');

  // Every referenced file must exist.
  const referenced = new Set();
  const collectIcons = (icons) => {
    for (const path of Object.values(icons ?? {})) referenced.add(path);
  };
  collectIcons(manifest.icons);
  collectIcons(manifest.action?.default_icon);
  collectIcons(manifest.sidebar_action?.default_icon);
  for (const script of manifest.background?.scripts ?? []) referenced.add(script);
  if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
  for (const page of [manifest.sidebar_action?.default_panel, manifest.action?.default_popup]) {
    if (page) referenced.add(page.split('?')[0]);
  }

  for (const path of referenced) {
    const exists = files.some((file) => rel(file) === path);
    if (!exists) fail(`manifest references ${path}, which is not in ${DIST_LABEL}.`);
  }
  notes.push(`manifest references ${referenced.size} packaged files, all present.`);
}

/* ------------------------------------------------------------ dist hygiene */

const maps = files.filter((file) => file.endsWith('.map'));
if (maps.length > 0) fail(`source maps must not be packaged: ${maps.map(rel).join(', ')}`);

for (const junk of ['.DS_Store', 'Thumbs.db']) {
  if (files.some((file) => file.endsWith(junk))) warnings.push(`${DIST_LABEL} contains ${junk}`);
}

// The full-page editor entry, which `openFullPageEditor` opens on both targets,
// plus the background code and (on Chrome) the popup document.
const REQUIRED_FILES =
  target === 'firefox'
    ? ['index.html', 'background.js']
    : ['index.html', 'popup.html', 'service-worker.js'];
for (const required of REQUIRED_FILES) {
  if (!files.some((file) => rel(file) === required)) fail(`${DIST_LABEL}${required} is missing.`);
}

/* ------------------------------------------------- self-containment checks */

const REMOTE_PATTERNS = [
  { pattern: /<script[^>]+src\s*=\s*["'](?:https?:)?\/\//i, message: 'remote <script src>' },
  { pattern: /<link[^>]+href\s*=\s*["'](?:https?:)?\/\//i, message: 'remote <link href>' },
  { pattern: /@import\s+(?:url\()?["']?https?:/i, message: 'remote CSS @import' },
  { pattern: /url\(\s*["']?https?:\/\//i, message: 'remote url() asset' },
  // Any `fetch(` at all, not just one with a literal URL: a variable argument
  // is exactly what an audit would otherwise miss. The extension performs no
  // network I/O, so the correct count is zero.
  { pattern: /\bfetch\s*\(/, message: 'a fetch() call' },
  { pattern: /\bnew\s+XMLHttpRequest\b/, message: 'XMLHttpRequest' },
  { pattern: /\bimportScripts\s*\(/, message: 'importScripts()' },
  { pattern: /\bnew\s+WebSocket\b/, message: 'WebSocket' },
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, message: 'navigator.sendBeacon' },
  { pattern: /\bnew\s+EventSource\b/, message: 'EventSource' },
];

const DYNAMIC_CODE_PATTERNS = [
  { pattern: /(^|[^.\w$])eval\s*\(/, message: 'eval(' },
  { pattern: /\bnew\s+Function\s*\(/, message: 'new Function(' },
];

const inlineScript = /<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i;

for (const file of files) {
  const ext = extname(file);
  if (!['.js', '.css', '.html', '.json'].includes(ext)) continue;
  const source = readFileSync(file, 'utf8');

  for (const { pattern, message } of REMOTE_PATTERNS) {
    if (pattern.test(source))
      fail(`${rel(file)} contains ${message} — the build must be self-contained.`);
  }
  if (ext === '.js') {
    for (const { pattern, message } of DYNAMIC_CODE_PATTERNS) {
      if (pattern.test(source)) {
        fail(`${rel(file)} contains ${message} which the extension CSP forbids.`);
      }
    }
  }
  if (ext === '.html' && inlineScript.test(source)) {
    fail(`${rel(file)} has an inline <script>, which the extension CSP forbids.`);
  }
}

/* ----------------------------------------------------------------- report */

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
notes.push(`${files.length} files, ${(totalBytes / 1024).toFixed(0)} KiB unpacked.`);

console.log(`\nBuild verification — ${TARGETS[target].label} (${DIST_LABEL})`);
console.log('-'.repeat(40));
for (const note of notes) console.log(`  ok      ${note}`);
for (const warning of warnings) console.log(`  warn    ${warning}`);
for (const error of errors) console.log(`  FAIL    ${error}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found in ${DIST_LABEL}.\n`);
  process.exit(1);
}
console.log(`\n${DIST_LABEL} is complete and self-contained.\n`);
