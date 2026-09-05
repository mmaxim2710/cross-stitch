import type { Pattern, PatternSummary } from '../types';
import { base64ToBytes } from '../util';
import { db } from './db';

type RawPattern = Omit<Pattern, 'cells'> & { cells: string };

function decode(raw: RawPattern): Pattern {
  const cells = base64ToBytes(raw.cells);
  if (!raw.id || !raw.width || !raw.height) throw new Error('в файле нет id, width или height');
  if (cells.length !== raw.width * raw.height) {
    throw new Error(`сетка ${cells.length} байт, ожидалось ${raw.width * raw.height}`);
  }
  return {
    id: raw.id,
    name: raw.name || 'Без названия',
    author: raw.author ?? '',
    width: raw.width,
    height: raw.height,
    stitchesPerInch: raw.stitchesPerInch ?? [14, 14],
    stitchCount: raw.stitchCount ?? 0,
    palette: raw.palette ?? [],
    cells,
  };
}

function summarise(p: Pattern | PatternSummary): PatternSummary {
  return { id: p.id, name: p.name, width: p.width, height: p.height, stitchCount: p.stitchCount };
}

/** Patterns bundled with (or served alongside) the app — see the Vite plugin. */
async function bundled(): Promise<PatternSummary[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}patterns/index.json`);
    if (!res.ok) return [];
    return (await res.json()) as PatternSummary[];
  } catch {
    return [];
  }
}

export async function listPatterns(): Promise<PatternSummary[]> {
  const stored = await db.allPatterns();
  const seen = new Set(stored.map((p) => p.id));
  const extra = (await bundled()).filter((p) => !seen.has(p.id));
  return [...stored.map(summarise), ...extra];
}

export async function loadPattern(id: string): Promise<Pattern> {
  const stored = await db.getPattern(id);
  if (stored) return stored;

  const res = await fetch(`${import.meta.env.BASE_URL}patterns/${encodeURIComponent(id)}.json`);
  if (!res.ok) throw new Error(`схема «${id}» не найдена`);
  const pattern = decode((await res.json()) as RawPattern);
  await db.putPattern(pattern); // cached so the app keeps working offline
  return pattern;
}

/** Reads a JSON produced by tools/xsd2json.py and keeps it on the device. */
export async function importPatternFile(file: File): Promise<Pattern> {
  const pattern = decode(JSON.parse(await file.text()) as RawPattern);
  await db.putPattern(pattern);
  return pattern;
}
