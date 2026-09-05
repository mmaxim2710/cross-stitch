/*
 * Copyright (C) 2026 mmaxim2710
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.  See <https://www.gnu.org/licenses/>.
 */

/**
 * Pattern Maker v4 (.xsd) reader — a port of tools/xsd2json.py, so that a chart
 * can be opened straight from the phone instead of being converted on a desktop.
 *
 * The binary layout follows the reverse-engineered description in Embroiderly
 * (https://github.com/embroidery-space/embroiderly, GPL-3.0),
 * crates/embroiderly-parsers/src/pmaker/xsd.rs.
 *
 * Both readers must agree byte for byte — see app/scripts/check-xsd.mjs. That
 * script runs this file under Node's type stripping, which resolves imports the
 * way the browser does, hence the explicit `.ts` extensions below.
 */

import type { PaletteEntry, Pattern } from '../types.ts';
import { EMPTY } from '../types.ts';

const SIGNATURE = 0x0510;
const FORMAT_LENGTH = 240;

/** Pattern Maker C-strings occupy `length` + 1 bytes; text is UTF-8 or CP1251. */
function cstring(bytes: Uint8Array, offset: number, length: number): string {
  let raw = bytes.subarray(offset, offset + length + 1);
  const end = raw.indexOf(0);
  if (end >= 0) raw = raw.subarray(0, end);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('windows-1251').decode(raw);
  }
}

function hexColour(bytes: Uint8Array, offset: number): string {
  let out = '#';
  for (let i = 0; i < 3; i++) out += bytes[offset + i].toString(16).padStart(2, '0');
  return out.toUpperCase();
}

type Header = {
  width: number;
  height: number;
  palette: { number: string; name: string; color: string }[];
  smallStitches: number;
  joints: number;
  stitchesPerInch: [number, number];
  title: string;
  author: string;
  stitchesOffset: number;
};

function parseHeader(bytes: Uint8Array, view: DataView): Header {
  const u16 = (o: number) => view.getUint16(o, true);
  const u32 = (o: number) => view.getUint32(o, true);

  if (u16(0) !== SIGNATURE) throw new Error('это не файл Pattern Maker v4');

  let o = 2 + 4 + 8 + 727; // signature, unknown, version, unknown
  const width = u16(o);
  const height = u16(o + 2);
  const smallStitches = u32(o + 4);
  const joints = u16(o + 8);
  const stitchesPerInch: [number, number] = [u16(o + 10), u16(o + 12)];
  o += 14 + 6;

  const paletteSize = u16(o);
  o += 2;
  const palette: Header['palette'] = [];
  for (let i = 0; i < paletteSize; i++) {
    const start = o;
    o += 2;
    o += 1; // brand id
    const number = cstring(bytes, o, 10);
    o += 11;
    const name = cstring(bytes, o, 40);
    o += 41;
    const color = hexColour(bytes, o);
    o += 3;
    o += 1;
    const blends = u16(o);
    o += 2;
    o += blends * 12 + (4 - blends) * 12; // blends and their empty slots
    o += 4; // blend strands
    o += 4; // is-bead flag
    o += 4; // bead length + diameter
    o += 2;
    if (o - start !== 123) throw new Error('размер записи палитры не сошёлся');
    palette.push({ number, name, color });
  }

  o += paletteSize * 2; // palette item positions
  for (let i = 0; i < paletteSize; i++) {
    for (let kind = 0; kind < 9; kind++) o += 2 + u16(o); // per-item notes
  }
  o += paletteSize * 16; // per-item strand counts

  o += FORMAT_LENGTH * (10 + 10 + 4 + 10 + 10 + 10 + 10 + 53); // formats
  o += paletteSize * 12; // symbols
  o += 380; // pattern + print settings
  o += 56; // grid
  o += 109; // fabric colour name and colour
  const title = cstring(bytes, o, 40);
  const author = cstring(bytes, o + 41, 40);
  o += 2373 + 6 + 41 + 206; // pattern info, fabric kind
  o += 52 + 32; // stitch and symbol settings
  o += 16412 + 512; // library info, machine export info

  return {
    width,
    height,
    palette,
    smallStitches,
    joints,
    stitchesPerInch,
    title,
    author,
    stitchesOffset: o,
  };
}

/** The stitch grid is XOR-obfuscated with a rotating key, then run-length encoded. */
function decodeStitches(view: DataView, offset: number, total: number): Uint32Array {
  const u32 = (o: number) => view.getUint32(o, true);

  const rnd = [u32(offset), u32(offset + 4), u32(offset + 8), u32(offset + 12)] as const;
  let o = offset + 16;

  const packed = new Uint8Array(16);
  const packedView = new DataView(packed.buffer);
  for (let i = 0; i < 4; i++) packedView.setUint32(i * 4, rnd[i], true);

  let key = rnd[0];
  key = ((key << 8) | packed[5]) >>> 0;
  key = ((key << 8) | packed[10]) >>> 0;
  key = ((key << 8) | (rnd[3] & 0xff)) >>> 0;

  const shifts: number[] = [];
  for (let i = 0; i < 16; i++) shifts.push((rnd[i >> 2] >>> (i & 3)) % 32);

  const cells = new Uint32Array(total);
  let n = 0;
  let counter = rnd[0];
  let shiftIndex = 0;
  let decoded = new Uint32Array(0);

  while (n < total) {
    const run = u32(o);
    o += 4;
    if (run === 0) continue;

    if (decoded.length < run) decoded = new Uint32Array(run);
    for (let i = 0; i < run; i++) {
      decoded[i] = (u32(o) ^ key ^ counter) >>> 0;
      o += 4;
      const s = shifts[shiftIndex];
      if (s) key = ((key << s) | (key >>> (32 - s))) >>> 0;
      counter = (counter + rnd[1]) >>> 0;
      shiftIndex = (shiftIndex + 1) % 16;
    }

    for (let i = 0; i < run; i++) {
      let repeat = 1;
      if (decoded[i] & 0x40000000) {
        repeat = (decoded[i] & 0x3fffffff) >>> 16;
        i++;
      }
      if (n + repeat > total) throw new Error('в сетке больше клеток, чем объявлено');
      cells.fill(decoded[i], n, n + repeat);
      n += repeat;
    }
  }

  return cells;
}

export type XsdWarning = { smallStitches: number; joints: number };

export type XsdResult = { pattern: Pattern; warning: XsdWarning | null };

/**
 * `id` is normally derived from the file name; it is what the pattern is stored
 * and synced under.
 */
export function parseXsd(buffer: ArrayBuffer, id: string): XsdResult {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const head = parseHeader(bytes, view);
  const total = head.width * head.height;
  if (total === 0) throw new Error('в файле нет сетки');

  const raw = decodeStitches(view, head.stitchesOffset, total);
  const cells = new Uint8Array(total);
  const counts = new Uint32Array(Math.max(head.palette.length, 1));
  let stitchCount = 0;

  for (let i = 0; i < total; i++) {
    const value = raw[i];
    const kind = (value >>> 24) & 0xff;
    const index = (value >>> 16) & 0xff;
    // kind 0 is a full cross; 15 is an empty cell; everything else is a part
    // stitch, which this app does not draw.
    if (kind === 0 && index < head.palette.length) {
      cells[i] = index;
      counts[index] = counts[index] + 1;
      stitchCount++;
    } else {
      cells[i] = EMPTY;
    }
  }

  const palette: PaletteEntry[] = head.palette.map((p, i) => ({
    index: i,
    color: p.color,
    number: p.number,
    name: p.name,
    dmc: null,
    count: counts[i],
  }));

  return {
    pattern: {
      id,
      name: head.title || 'Без названия',
      author: head.author,
      width: head.width,
      height: head.height,
      stitchesPerInch: head.stitchesPerInch,
      stitchCount,
      palette,
      cells,
    },
    warning:
      head.smallStitches || head.joints
        ? { smallStitches: head.smallStitches, joints: head.joints }
        : null,
  };
}
