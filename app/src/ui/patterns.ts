import { thumbnailUrl } from '../render/thumbnail';
import { db } from '../state/db';
import { importPatternFile, listPatterns, summarise } from '../state/pattern';
import type { PatternSummary } from '../types';
import { countBits } from '../util';
import { pickFile } from './files';
import { closeSheet, openSheet } from './sheet';

const nf = new Intl.NumberFormat('ru-RU');

type Row = PatternSummary & { thumbnail: string | null; percent: number | null };

/**
 * Charts stored on the device carry their cells, so they get a preview and a real
 * percentage; ones known only from the server list are shown without, until opened.
 */
async function rows(): Promise<Row[]> {
  const [summaries, stored, progress] = await Promise.all([
    listPatterns(),
    db.allPatterns(),
    db.allProgress(),
  ]);
  const cells = new Map(stored.map((p) => [p.id, p]));
  const done = new Map(progress.map((p) => [p.patternId, countBits(p.bits)]));

  return summaries.map((summary) => {
    const full = cells.get(summary.id);
    const total = summary.stitchCount || full?.stitchCount || 0;
    const marked = done.get(summary.id);
    return {
      ...summarise(full ?? summary),
      thumbnail: full ? thumbnailUrl(full) : null,
      percent: marked !== undefined && total ? Math.round((marked / total) * 100) : null,
    };
  });
}

export type PatternListOptions = {
  currentId: string | null;
  onOpen: (id: string) => void | Promise<void>;
  onError: (message: string) => void;
};

export async function openPatternList(options: PatternListOptions): Promise<void> {
  const box = document.createElement('div');

  for (const row of await rows()) {
    const button = document.createElement('button');
    button.className = 'row' + (row.id === options.currentId ? ' selected' : '');

    const preview = document.createElement('span');
    preview.className = 'thumb';
    if (row.thumbnail) {
      const img = document.createElement('img');
      img.src = row.thumbnail;
      img.alt = '';
      preview.append(img);
    }

    const grow = document.createElement('span');
    grow.className = 'grow';
    const title = document.createElement('b');
    title.textContent = row.name;
    const meta = document.createElement('span');
    meta.className = 'count';
    meta.textContent =
      `${row.width} × ${row.height} · ${nf.format(row.stitchCount)} крестиков` +
      (row.percent === null ? '' : ` · ${row.percent}%`);
    grow.append(title, meta);

    button.append(preview, grow);
    button.onclick = () => {
      closeSheet();
      void options.onOpen(row.id);
    };
    box.append(button);
  }

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  const add = document.createElement('button');
  add.textContent = 'Открыть схему (.xsd или .json)';
  add.onclick = async () => {
    const file = await pickFile('.xsd,.json,application/json');
    if (!file) return;
    try {
      const { pattern, warning } = await importPatternFile(file);
      closeSheet();
      await options.onOpen(pattern.id);
      if (warning) options.onError(warning);
    } catch (err) {
      options.onError(`Не удалось открыть файл: ${err instanceof Error ? err.message : err}`);
    }
  };
  actions.append(add);
  box.append(actions);

  openSheet('Схемы', box);
}
