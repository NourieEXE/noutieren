#!/usr/bin/env node
/**
 * Zips `chrome_version/dist/` into an upload for the Chrome Web Store.
 *
 * Written by hand for the same reason `generate-icons.mjs` encodes its own PNGs:
 * the alternative is a dependency, and the format needed here is small. Node has
 * no zip writer, and `web-ext` builds for Firefox.
 *
 * Every entry is stored with a fixed 1980-01-01 timestamp, so packaging the same
 * `dist/` twice produces byte-identical archives — the property BUILDING.md
 * relies on to let anyone reproduce a published package.
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'chrome_version', 'dist');
const OUT_DIR = join(ROOT, 'chrome_version', 'web-ext-artifacts');

/* MS-DOS 1980-01-01 00:00:00: date = (year-1980)<<9 | month<<5 | day. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

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

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error('chrome_version/dist/ does not exist. Run `npm run build:chrome` first.');
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')).version;

const locals = [];
const central = [];
let offset = 0;

for (const file of files) {
  // Zip entries always use forward slashes, whatever the host platform does.
  const name = Buffer.from(relative(DIST, file).split('\\').join('/'), 'utf8');
  const contents = readFileSync(file);
  const deflated = deflateRawSync(contents, { level: 9 });
  // A tiny or incompressible file can deflate larger than it started; store it
  // verbatim in that case, which is what method 0 is for.
  const deflate = deflated.length < contents.length;
  const body = deflate ? deflated : contents;
  const crc = crc32(contents);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed to extract
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(deflate ? 8 : 0, 8); // compression method
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18); // compressed size
  local.writeUInt32LE(contents.length, 22); // uncompressed size
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // extra field length
  locals.push(local, name, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); // central directory signature
  entry.writeUInt16LE(20, 4); // version made by
  entry.writeUInt16LE(20, 6); // version needed to extract
  entry.writeUInt16LE(0, 8); // flags
  entry.writeUInt16LE(deflate ? 8 : 0, 10);
  entry.writeUInt16LE(DOS_TIME, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(contents.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt16LE(0, 30); // extra field length
  entry.writeUInt16LE(0, 32); // comment length
  entry.writeUInt16LE(0, 34); // disk number start
  entry.writeUInt16LE(0, 36); // internal attributes
  entry.writeUInt32LE(0o644 << 16, 38); // external attributes: regular file
  entry.writeUInt32LE(offset, 42); // offset of the local header
  central.push(entry, name);

  offset += local.length + name.length + body.length;
}

const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
end.writeUInt16LE(0, 4); // this disk number
end.writeUInt16LE(0, 6); // disk with the central directory
end.writeUInt16LE(files.length, 8); // entries on this disk
end.writeUInt16LE(files.length, 10); // entries in total
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16); // central directory offset
end.writeUInt16LE(0, 20); // comment length

const archive = Buffer.concat([...locals, directory, end]);
mkdirSync(OUT_DIR, { recursive: true });
const target = join(OUT_DIR, `noutieren-${version}-chrome.zip`);
writeFileSync(target, archive);

console.log(`\n${relative(ROOT, target)}`);
console.log(`  ${files.length} files, ${(archive.length / 1024).toFixed(0)} KiB compressed.`);
console.log('\nUpload this at https://chrome.google.com/webstore/devconsole\n');
