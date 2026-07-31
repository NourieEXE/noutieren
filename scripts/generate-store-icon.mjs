#!/usr/bin/env node
/**
 * Generates the store listing icon.
 *
 * Both the Chrome Web Store and addons.mozilla.org want a 128x128 PNG, and both
 * show it standing alone on a page rather than on browser chrome. The packaged
 * toolbar icon is drawn on transparency for the opposite reason, and looks
 * unanchored in that context — so this one sits on a dark rounded tile, which
 * also survives being shrunk to the 32px used in listings and search results.
 *
 * Same bars, same geometry, same rasterizer (`lib/icon.mjs`); only the backdrop
 * differs. One file serves both stores.
 *
 * Usage: `npm run icon:store`  ->  docs/store/store-icon-128.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, renderIcon } from './lib/icon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'store');

/**
 * Values in design-grid units on the 128 grid. The inset keeps the bars clear of
 * the tile's rounded corners; the radius matches what both stores render around
 * their own tiles closely enough not to fight it.
 */
const TILE = {
  from: '#243044',
  to: '#111827',
  radius: 26,
  inset: 15,
};

/** 128 is what both stores ask for; 512 is kept for press and README use. */
const SIZES = [128, 512];

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT, `store-icon-${size}.png`);
  writeFileSync(file, encodePng(renderIcon(size, TILE), size));
  console.log(`store icon  ${String(size).padStart(3)}px  ->  ${relative(ROOT, file)}`);
}
