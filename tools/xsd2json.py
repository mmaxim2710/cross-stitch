#!/usr/bin/env python3
#
# Copyright (C) 2026 mmaxim2710
#
# This program is free software: you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free Software
# Foundation, either version 3 of the License, or (at your option) any later
# version.
#
# This program is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
# PARTICULAR PURPOSE.  See the GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License along with
# this program.  If not, see <https://www.gnu.org/licenses/>.
"""Converts a Pattern Maker v4 .xsd chart into the compact JSON used by the app.

The binary layout follows the reverse-engineered description in Embroiderly
(https://github.com/embroidery-space/embroiderly, GPL-3.0), crates/embroiderly-parsers/src/pmaker/xsd.rs.

Usage:  python tools/xsd2json.py schemas_example/night.xsd data/night.json
"""
import base64
import collections
import json
import os
import struct
import sys

SIGNATURE = 0x0510
FORMAT_LENGTH = 240
EMPTY = 0xFF  # cell value meaning "no stitch"


def u16(d, o): return struct.unpack_from('<H', d, o)[0]
def u32(d, o): return struct.unpack_from('<I', d, o)[0]


def cstring(d, o, length):
    """Pattern Maker C-strings occupy `length` + 1 bytes; text is UTF-8 or CP1251."""
    raw = d[o:o + length + 1]
    end = raw.find(0)
    if end >= 0:
        raw = raw[:end]
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('cp1251', 'replace')


def parse_header(d):
    if u16(d, 0) != SIGNATURE:
        raise ValueError('not a Pattern Maker v4 file')

    o = 2 + 4 + 8 + 727  # signature, unknown, version, unknown
    width, height = u16(d, o), u16(d, o + 2)
    small_stitches = u32(d, o + 4)
    joints = u16(d, o + 8)
    stitches_per_inch = (u16(d, o + 10), u16(d, o + 12))
    o += 14 + 6

    palette_size = u16(d, o)
    o += 2
    palette = []
    for _ in range(palette_size):
        start = o
        o += 2
        o += 1  # brand id
        number = cstring(d, o, 10); o += 11
        name = cstring(d, o, 40); o += 41
        color = d[o:o + 3].hex().upper(); o += 3
        o += 1
        blends = u16(d, o); o += 2
        o += blends * 12 + (4 - blends) * 12  # blends and their empty slots
        o += 4                                # blend strands
        o += 4                                # is-bead flag
        o += 4                                # bead length + diameter
        o += 2
        assert o - start == 123, 'palette item size drift'
        palette.append({'number': number, 'name': name, 'color': color})

    o += palette_size * 2                     # palette item positions
    for _ in range(palette_size):             # per-item notes, 9 stitch types each
        for _ in range(9):
            o += 2 + u16(d, o)
    o += palette_size * 16                    # per-item strand counts

    o += FORMAT_LENGTH * (10 + 10 + 4 + 10 + 10 + 10 + 10 + 53)  # formats
    o += palette_size * 12                                       # symbols
    o += 380                                  # pattern + print settings
    o += 56                                   # grid
    o += 109                                  # fabric colour name and colour
    title = cstring(d, o, 40)
    author = cstring(d, o + 41, 40)
    o += 2373 + 6 + 41 + 206                  # pattern info, fabric kind
    o += 52 + 32                              # stitch and symbol settings
    o += 16412 + 512                          # library info, machine export info

    return {
        'width': width, 'height': height, 'palette': palette,
        'small_stitches': small_stitches, 'joints': joints,
        'stitches_per_inch': stitches_per_inch,
        'title': title, 'author': author, 'stitches_offset': o,
    }


def decode_stitches(d, offset, total):
    """The stitch grid is XOR-obfuscated with a rotating key, then run-length encoded."""
    rnd = [u32(d, offset + 4 * i) for i in range(4)]
    o = offset + 16

    packed = b''.join(struct.pack('<I', x) for x in rnd)
    key = ((((((rnd[0] << 8) | packed[5]) << 8) | packed[10]) << 8) | (rnd[3] & 0xFF)) & 0xFFFFFFFF
    shifts = [(u32(packed, (i // 4) * 4) >> (i % 4)) % 32 for i in range(16)]

    cells = []
    counter = rnd[0]
    shift_index = 0
    while len(cells) < total:
        run = u32(d, o); o += 4
        if run == 0:
            continue

        decoded = []
        for _ in range(run):
            decoded.append(u32(d, o) ^ key ^ counter)
            o += 4
            s = shifts[shift_index]
            if s:
                key = ((key << s) | (key >> (32 - s))) & 0xFFFFFFFF
            counter = (counter + rnd[1]) & 0xFFFFFFFF
            shift_index = (shift_index + 1) % 16

        i = 0
        while i < run:
            repeat = 1
            if decoded[i] & 0x40000000:
                repeat = (decoded[i] & 0x3FFFFFFF) >> 16
                i += 1
            cells.extend([decoded[i]] * repeat)
            i += 1

    if len(cells) != total:
        raise ValueError('decoded %d cells, expected %d' % (len(cells), total))
    return cells


def convert(src, dst, pattern_id=None):
    d = open(src, 'rb').read()
    head = parse_header(d)
    width, height = head['width'], head['height']

    if head['small_stitches'] or head['joints']:
        print('warning: file has %d part stitches and %d joints (backstitch / knots); '
              'these are not represented in the output'
              % (head['small_stitches'], head['joints']), file=sys.stderr)

    raw = decode_stitches(d, head['stitches_offset'], width * height)
    cells = bytearray(width * height)
    counts = collections.Counter()
    for i, value in enumerate(raw):
        kind = (value >> 24) & 0xFF
        if kind == 15:
            cells[i] = EMPTY
        elif kind == 0:
            index = (value >> 16) & 0xFF
            cells[i] = index
            counts[index] += 1
        else:
            cells[i] = EMPTY  # part stitch, not supported

    palette = [
        {'index': i, 'color': '#' + p['color'], 'number': p['number'],
         'name': p['name'], 'dmc': None, 'count': counts.get(i, 0)}
        for i, p in enumerate(head['palette'])
    ]

    out = {
        'id': pattern_id or os.path.splitext(os.path.basename(src))[0],
        'name': head['title'] or 'Без названия',
        'author': head['author'],
        'width': width,
        'height': height,
        'stitchesPerInch': list(head['stitches_per_inch']),
        'stitchCount': sum(counts.values()),
        'palette': palette,
        'cells': base64.b64encode(bytes(cells)).decode('ascii'),
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    print('%s -> %s' % (src, dst))
    print('  %s (%s), %dx%d, %d colours, %d stitches'
          % (out['name'], out['author'], width, height, len(palette), out['stitchCount']))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    convert(sys.argv[1], sys.argv[2])
