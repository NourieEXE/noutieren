#!/usr/bin/env node
/**
 * Generates the extension's PNG icons locally — no network, no image library.
 *
 * The artwork is three stacked, left-aligned colored bars (a list of
 * color-labeled notes) drawn on a 128x128 design grid. Each size is rendered
 * 4x supersampled and box-downsampled for antialiasing, then encoded as an
 * 8-bit RGBA PNG using only Node's built-in zlib.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Both targets get the same artwork. Each build only copies its own `public/`
 * directory, so the icons are written twice rather than shared — they are a few
 * kilobytes, and the alternative is a copy step in two Vite configs.
 */
const OUT_DIRS = [join(ROOT, 'public', 'icons'), join(ROOT, 'chrome_version', 'public', 'icons')];
const SIZES = [16, 32, 48, 96, 128];
const GRID = 128; // design-grid units
const SS = 4; // supersampling factor

/** Rounded bars on the 128-unit design grid: [x, y, width, height, radius]. */
const BARS = [
  { rect: [20, 19, 88, 22, 8], color: '#f59e0b' },
  { rect: [20, 53, 76, 22, 8], color: '#22d3ee' },
  { rect: [20, 87, 64, 22, 8], color: '#a78bfa' },
];
const OUTLINE = '#0f172a';
const OUTLINE_ALPHA = 0.55;
const OUTLINE_WIDTH = 3; // design-grid units

function parseHex(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

/** Signed-distance test for a rounded rectangle. */
function insideRoundRect(px, py, x, y, w, h, r) {
  const dx = Math.max(x + r - px, 0, px - (x + w - r));
  const dy = Math.max(y + r - py, 0, py - (y + h - r));
  return dx * dx + dy * dy <= r * r;
}

/**
 * Composites a rounded rect over the canvas. Colours are stored premultiplied
 * so that downsampling averages correctly around antialiased edges.
 */
function fillRoundRect(canvas, w, h, rect, color, alpha) {
  const [x, y, rw, rh, r] = rect;
  const [cr, cg, cb] = parseHex(color);
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(w, Math.ceil(x + rw));
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(h, Math.ceil(y + rh));

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      if (!insideRoundRect(px + 0.5, py + 0.5, x, y, rw, rh, r)) continue;
      const i = (py * w + px) * 4;
      const inv = 1 - alpha;
      canvas[i] = cr * alpha + canvas[i] * inv;
      canvas[i + 1] = cg * alpha + canvas[i + 1] * inv;
      canvas[i + 2] = cb * alpha + canvas[i + 2] * inv;
      canvas[i + 3] = alpha + canvas[i + 3] * inv;
    }
  }
}

/** Renders the artwork at `size` px and returns straight-alpha RGBA bytes. */
function renderIcon(size) {
  const w = size * SS;
  const h = size * SS;
  const scale = (size * SS) / GRID;
  const canvas = new Float64Array(w * h * 4);

  const scaleRect = ([x, y, rw, rh, r], grow = 0) => [
    (x - grow) * scale,
    (y - grow) * scale,
    (rw + grow * 2) * scale,
    (rh + grow * 2) * scale,
    (r + grow) * scale,
  ];

  // Outline first, then the colour on top, leaving a thin dark edge that keeps
  // the bars readable on both light and dark toolbars.
  for (const bar of BARS) {
    fillRoundRect(canvas, w, h, scaleRect(bar.rect, OUTLINE_WIDTH), OUTLINE, OUTLINE_ALPHA);
  }
  for (const bar of BARS) {
    fillRoundRect(canvas, w, h, scaleRect(bar.rect), bar.color, 1);
  }

  // Box-downsample the supersampled canvas.
  const out = Buffer.alloc(size * size * 4);
  const samples = SS * SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * w + (x * SS + sx)) * 4;
          r += canvas[i];
          g += canvas[i + 1];
          b += canvas[i + 2];
          a += canvas[i + 3];
        }
      }
      r /= samples;
      g /= samples;
      b /= samples;
      a /= samples;
      const o = (y * size + x) * 4;
      // Un-premultiply for PNG's straight-alpha storage.
      const unpremultiply = (channel) => (a === 0 ? 0 : Math.round((channel / a) * 255));
      out[o] = unpremultiply(r);
      out[o + 1] = unpremultiply(g);
      out[o + 2] = unpremultiply(b);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const png = encodePng(renderIcon(size), size);
  for (const dir of OUT_DIRS) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `icon-${size}.png`), png);
  }
  console.log(`icon  ${String(size).padStart(3)}px  ->  ${OUT_DIRS.length} targets`);
}
