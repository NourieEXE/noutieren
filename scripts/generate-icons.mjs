#!/usr/bin/env node
/**
 * Generates the extension's packaged PNG icons.
 *
 * These are the toolbar and management icons, so they are drawn on
 * transparency: they sit on browser chrome that may be light or dark, and a
 * filled tile would look like a sticker on it. The store listing icon is a
 * different job and lives in `generate-store-icon.mjs`.
 *
 * The artwork and the PNG encoder are in `lib/icon.mjs`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, renderIcon } from './lib/icon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Both targets get the same artwork. Each build only copies its own `public/`
 * directory, so the icons are written twice rather than shared — they are a few
 * kilobytes, and the alternative is a copy step in two Vite configs.
 */
const OUT_DIRS = [join(ROOT, 'public', 'icons'), join(ROOT, 'chrome_version', 'public', 'icons')];
const SIZES = [16, 32, 48, 96, 128];

for (const size of SIZES) {
  const png = encodePng(renderIcon(size), size);
  for (const dir of OUT_DIRS) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `icon-${size}.png`), png);
  }
  console.log(`icon  ${String(size).padStart(3)}px  ->  ${OUT_DIRS.length} targets`);
}
