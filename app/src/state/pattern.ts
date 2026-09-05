import { parseXsd } from '../formats/xsd';
import { currentApi } from '../sync/api';
import type { Pattern, PatternSummary, RawPattern } from '../types';
import { base64ToBytes, bytesToBase64 } from '../util';
import { db } from './db';

export function decodePattern(raw: RawPattern): Pattern {
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

export function encodePattern(pattern: Pattern): RawPattern {
  return { ...pattern, cells: bytesToBase64(pattern.cells) };
}

export function summarise(p: Pattern | PatternSummary): PatternSummary {
  return { id: p.id, name: p.name, width: p.width, height: p.height, stitchCount: p.stitchCount };
}

/** Patterns served alongside the app — see the Vite plugin; empty on Pages. */
async function bundled(): Promise<PatternSummary[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}patterns/index.json`);
    if (!res.ok) return [];
    return (await res.json()) as PatternSummary[];
  } catch {
    return [];
  }
}

async function remote(): Promise<PatternSummary[]> {
  try {
    return (await currentApi()?.listPatterns()) ?? [];
  } catch {
    return []; // offline or misconfigured: the local list still works
  }
}

export async function listPatterns(): Promise<PatternSummary[]> {
  const stored = await db.allPatterns();
  const seen = new Set(stored.map((p) => p.id));
  const list = stored.map(summarise);
  for (const p of [...(await bundled()), ...(await remote())]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    list.push(p);
  }
  return list;
}

export async function loadPattern(id: string): Promise<Pattern> {
  const stored = await db.getPattern(id);
  if (stored) return stored;

  const res = await fetch(`${import.meta.env.BASE_URL}patterns/${encodeURIComponent(id)}.json`);
  if (res.ok) {
    const pattern = decodePattern((await res.json()) as RawPattern);
    await db.putPattern(pattern); // cached so the app keeps working offline
    return pattern;
  }

  const fromServer = await currentApi()?.getPattern(id);
  if (fromServer) {
    const pattern = decodePattern(fromServer);
    await db.putPattern(pattern);
    return pattern;
  }

  throw new Error(`схема «${id}» не найдена`);
}

/** File name without the extension, cleaned up into something usable as a key. */
function idFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim();
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `pattern-${Date.now()}`;
}

export type ImportResult = { pattern: Pattern; warning: string | null };

/** Accepts a raw .xsd or a JSON produced by tools/xsd2json.py. */
export async function importPatternFile(file: File): Promise<ImportResult> {
  let pattern: Pattern;
  let warning: string | null = null;

  if (/\.xsd$/i.test(file.name)) {
    const result = parseXsd(await file.arrayBuffer(), idFromName(file.name));
    pattern = result.pattern;
    if (result.warning) {
      const { smallStitches, joints } = result.warning;
      warning =
        `В схеме есть ${smallStitches} частичных стежков и ${joints} узелков/бэкстича — ` +
        'они не отображаются.';
    }
  } else {
    pattern = decodePattern(JSON.parse(await file.text()) as RawPattern);
  }

  await db.putPattern(pattern);
  return { pattern, warning };
}
