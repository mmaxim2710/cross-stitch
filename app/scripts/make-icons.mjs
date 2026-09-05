/**
 * Draws the app icons — a small stitched motif on canvas-coloured ground — without
 * pulling in an image library. Run with `npm run icons`; the output is committed.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [0x1b, 0x1d, 0x21];
const FABRIC = [0x2a, 0x2d, 0x33];
const THREAD = [
  [0xd6, 0x71, 0x22],
  [0xaf, 0x9c, 0x48],
  [0x4a, 0x70, 0x4f],
  [0xbf, 0x39, 0x16],
];

// 9x9 motif: 0 empty, 1..4 index into THREAD.
const MOTIF = [
  [0, 0, 3, 0, 0, 0, 3, 0, 0],
  [0, 3, 2, 3, 0, 3, 2, 3, 0],
  [3, 2, 1, 2, 3, 2, 1, 2, 3],
  [0, 3, 2, 3, 4, 3, 2, 3, 0],
  [0, 0, 3, 4, 1, 4, 3, 0, 0],
  [0, 3, 2, 3, 4, 3, 2, 3, 0],
  [3, 2, 1, 2, 3, 2, 1, 2, 3],
  [0, 3, 2, 3, 0, 3, 2, 3, 0],
  [0, 0, 3, 0, 0, 0, 3, 0, 0],
];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, pixel) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  // A maskable icon keeps its subject inside the middle 80%.
  const grid = 13;
  const cell = size / grid;
  const inset = (grid - MOTIF.length) / 2;
  return (x, y) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    if (gx < 1 || gy < 1 || gx >= grid - 1 || gy >= grid - 1) return BG;
    const row = MOTIF[gy - inset];
    const value = row ? row[gx - inset] : 0;
    return value ? THREAD[value - 1] : FABRIC;
  };
}

mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, png(size, draw(size)));
  console.log(file);
}
