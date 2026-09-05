/**
 * Cross-checks the TypeScript .xsd reader against the Python one: both must
 * produce the same grid for the same file.
 *
 *   node --experimental-strip-types scripts/check-xsd.mjs [chart.xsd] [chart.json]
 *
 * Defaults to schemas_example/night.xsd and data/night.json, neither of which is
 * in the repository — run tools/xsd2json.py first.
 */
import { readFile } from 'node:fs/promises';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXsd } from '../src/formats/xsd.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const xsdPath = process.argv[2] ?? resolve(root, 'schemas_example', 'night.xsd');
const jsonPath = process.argv[3] ?? resolve(root, 'data', 'night.json');

const id = basename(xsdPath).replace(/\.xsd$/i, '');
const buffer = await readFile(xsdPath);
const { pattern } = parseXsd(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), id);
const expected = JSON.parse(await readFile(jsonPath, 'utf8'));

const fail = (message) => {
  console.error(`РАСХОЖДЕНИЕ: ${message}`);
  process.exitCode = 1;
};

for (const key of ['id', 'name', 'author', 'width', 'height', 'stitchCount']) {
  if (String(pattern[key]) !== String(expected[key])) {
    fail(`${key}: TS «${pattern[key]}», Python «${expected[key]}»`);
  }
}

const expectedCells = Buffer.from(expected.cells, 'base64');
if (expectedCells.length !== pattern.cells.length) {
  fail(`длина сетки: ${pattern.cells.length} против ${expectedCells.length}`);
} else {
  let diff = 0;
  let first = -1;
  for (let i = 0; i < expectedCells.length; i++) {
    if (expectedCells[i] !== pattern.cells[i]) {
      if (first < 0) first = i;
      diff++;
    }
  }
  if (diff) fail(`${diff} клеток расходятся, первая — индекс ${first}`);
}

if (pattern.palette.length !== expected.palette.length) {
  fail(`палитра: ${pattern.palette.length} против ${expected.palette.length}`);
} else {
  for (const [i, entry] of pattern.palette.entries()) {
    const other = expected.palette[i];
    if (entry.color !== other.color || entry.number !== other.number || entry.count !== other.count) {
      fail(`палитра #${i}: ${JSON.stringify(entry)} против ${JSON.stringify(other)}`);
    }
  }
}

if (!process.exitCode) {
  console.log(
    `совпадает: ${pattern.name} (${pattern.author}), ${pattern.width}×${pattern.height}, ` +
      `${pattern.palette.length} цветов, ${pattern.stitchCount} крестиков`,
  );
}
