import './style.css';

import { Renderer } from './render/renderer';
import { currentTheme, onThemeChange } from './render/theme';
import { requestPersistence } from './state/db';
import { importPatternFile, listPatterns, loadPattern } from './state/pattern';
import { Progress } from './state/progress';
import type { Pattern, PatternSummary } from './types';
import { EMPTY } from './types';
import { attachInteraction, type Mode } from './ui/interaction';
import { paletteList, renderChips } from './ui/palette';
import { closeSheet, openSheet, sheetIsOpen } from './ui/sheet';

const LAST_PATTERN = 'cross-stitch:last-pattern';

const app = document.getElementById('app') as HTMLDivElement;
const splash = document.getElementById('splash') as HTMLDivElement;
const splashText = document.getElementById('splash-text') as HTMLParagraphElement;
const stage = document.querySelector('.stage') as HTMLDivElement;
const chips = document.getElementById('chips') as HTMLDivElement;
const nameEl = document.getElementById('pattern-name') as HTMLSpanElement;
const statsEl = document.getElementById('pattern-stats') as HTMLSpanElement;
const undoBtn = document.getElementById('undo') as HTMLButtonElement;
const redoBtn = document.getElementById('redo') as HTMLButtonElement;
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.modes button')];

type Session = {
  pattern: Pattern;
  progress: Progress;
  renderer: Renderer;
};

let session: Session | null = null;
let mode: Mode = 'view';
let selected: number | null = null;

const nf = new Intl.NumberFormat('ru-RU');

function showSplash(message: string, actions?: Node): void {
  splashText.textContent = message;
  splash.querySelector('.actions')?.remove();
  if (actions) {
    const box = document.createElement('div');
    box.className = 'actions';
    box.append(actions);
    splashText.after(box);
  }
  splash.hidden = false;
  app.hidden = true;
}

function updateStats(): void {
  if (!session) return;
  const { pattern, progress } = session;
  const total = pattern.stitchCount || 1;
  const percent = Math.round((progress.done / total) * 100);
  statsEl.textContent =
    `${pattern.width} × ${pattern.height} · ${percent}% · ` +
    `${nf.format(progress.done)} из ${nf.format(pattern.stitchCount)}`;
  undoBtn.disabled = !progress.canUndo;
  redoBtn.disabled = !progress.canRedo;
}

function selectColour(index: number | null): void {
  selected = index;
  session?.renderer.setSelected(index);
  if (session) renderChips(chips, session.pattern, selected, selectColour);
  if (sheetIsOpen()) closeSheet();
}

function setMode(next: Mode): void {
  mode = next;
  for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === next);
}

async function openPattern(id: string): Promise<void> {
  await session?.progress.flush();

  const pattern = await loadPattern(id);
  const progress = await Progress.load(pattern.id, pattern.width * pattern.height);

  // A fresh canvas per pattern: the old one carries its own gesture listeners.
  const canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  stage.replaceChildren(canvas);

  const renderer = new Renderer(canvas, pattern, progress, currentTheme());
  session = { pattern, progress, renderer };
  selected = null;

  // The canvas has to be on screen before it can be measured, so reveal first.
  splash.hidden = true;
  app.hidden = false;
  renderer.resize();
  renderer.viewport.fit();
  renderer.invalidate();

  progress.onChange(() => {
    renderer.invalidate();
    updateStats();
  });

  // Direction is fixed by the first stitched cell the gesture touches, so one
  // swipe either marks or unmarks throughout.
  let strokeValue: boolean | null = null;
  const paint = (index: number): void => {
    if (pattern.cells[index] === EMPTY) return;
    if (strokeValue === null) {
      strokeValue = !progress.get(index);
      progress.beginStroke(strokeValue);
    }
    progress.paint(index);
  };

  attachInteraction(canvas, renderer.viewport, {
    mode: () => mode,
    tap: (index) => {
      const value = pattern.cells[index];
      selectColour(value === EMPTY || value === selected ? null : value);
    },
    strokeStart: (index) => {
      strokeValue = null;
      paint(index);
    },
    strokeMove: paint,
    strokeEnd: () => {
      progress.endStroke();
      strokeValue = null;
    },
    changed: () => renderer.requestDraw(),
  });

  nameEl.textContent = pattern.name;
  renderChips(chips, pattern, null, selectColour);
  updateStats();
  localStorage.setItem(LAST_PATTERN, pattern.id);
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

async function importPattern(): Promise<void> {
  const file = await pickFile();
  if (!file) return;
  try {
    const pattern = await importPatternFile(file);
    closeSheet();
    await openPattern(pattern.id);
  } catch (err) {
    alert(`Не удалось открыть файл: ${err instanceof Error ? err.message : err}`);
  }
}

async function showPatternList(): Promise<void> {
  const patterns = await listPatterns();
  const box = document.createElement('div');

  for (const p of patterns) {
    const row = document.createElement('button');
    row.className = 'row' + (p.id === session?.pattern.id ? ' selected' : '');
    const grow = document.createElement('span');
    grow.className = 'grow';
    const title = document.createElement('b');
    title.textContent = p.name;
    const meta = document.createElement('span');
    meta.className = 'count';
    meta.textContent = `${p.width} × ${p.height} · ${nf.format(p.stitchCount)} крестиков`;
    grow.append(title, meta);
    row.append(grow);
    row.onclick = async () => {
      closeSheet();
      await openPattern(p.id);
    };
    box.append(row);
  }

  const actions = document.createElement('div');
  actions.className = 'sheet-actions';
  const add = document.createElement('button');
  add.textContent = 'Открыть схему (.json)';
  add.onclick = () => void importPattern();
  actions.append(add);
  box.append(actions);

  openSheet('Схемы', box);
}

function showPalette(): void {
  if (!session) return;
  openSheet('Цвета', paletteList(session.pattern, selected, selectColour));
}

document.getElementById('open-patterns')?.addEventListener('click', () => void showPatternList());
document.getElementById('open-palette')?.addEventListener('click', showPalette);
document.getElementById('fit')?.addEventListener('click', () => {
  if (!session) return;
  session.renderer.viewport.fit();
  session.renderer.requestDraw();
});
undoBtn.addEventListener('click', () => session?.progress.undo());
redoBtn.addEventListener('click', () => session?.progress.redo());
for (const b of modeButtons) {
  b.addEventListener('click', () => setMode(b.dataset.mode === 'mark' ? 'mark' : 'view'));
}

window.addEventListener('resize', () => {
  if (!session) return;
  session.renderer.resize();
  session.renderer.requestDraw();
});

onThemeChange(() => session?.renderer.setTheme(currentTheme()));

// Anything unsaved must reach IndexedDB before the tab is frozen or killed.
for (const event of ['visibilitychange', 'pagehide'] as const) {
  window.addEventListener(event, () => {
    if (event === 'visibilitychange' && document.visibilityState === 'visible') return;
    void session?.progress.flush();
  });
}

async function start(): Promise<void> {
  void requestPersistence();

  let patterns: PatternSummary[] = [];
  try {
    patterns = await listPatterns();
  } catch (err) {
    console.error(err);
  }

  const wanted = localStorage.getItem(LAST_PATTERN);
  const id = patterns.find((p) => p.id === wanted)?.id ?? patterns[0]?.id;

  if (!id) {
    const button = document.createElement('button');
    button.textContent = 'Открыть схему (.json)';
    button.onclick = () => void importPattern();
    showSplash(
      'Схем пока нет. Сконвертируйте .xsd через tools/xsd2json.py и откройте получившийся JSON.',
      button,
    );
    return;
  }

  try {
    await openPattern(id);
  } catch (err) {
    console.error(err);
    const retry = document.createElement('button');
    retry.textContent = 'Открыть схему (.json)';
    retry.onclick = () => void importPattern();
    showSplash(`Не удалось открыть схему: ${err instanceof Error ? err.message : err}`, retry);
  }
}

void start();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
