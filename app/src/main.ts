import './style.css';

import { Renderer } from './render/renderer';
import { currentTheme, onThemeChange } from './render/theme';
import { requestPersistence } from './state/db';
import { listPatterns, loadPattern } from './state/pattern';
import { Progress } from './state/progress';
import { LABELS, Sync } from './sync/sync';
import type { Pattern, PatternSummary } from './types';
import { EMPTY } from './types';
import { attachInteraction, type Mode } from './ui/interaction';
import { paletteList, renderChips } from './ui/palette';
import { openPatternList } from './ui/patterns';
import { openSettings } from './ui/settings';
import { closeSheet, openSheet, sheetIsOpen } from './ui/sheet';
import { keepScreenAwake } from './ui/wakelock';

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
const syncBtn = document.getElementById('sync-status') as HTMLButtonElement;
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.modes button')];

type Session = {
  pattern: Pattern;
  progress: Progress;
  renderer: Renderer;
};

const sync = new Sync();
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

function updateSyncBadge(): void {
  syncBtn.dataset.state = sync.state;
  syncBtn.title = sync.message ? `${LABELS[sync.state]}: ${sync.message}` : LABELS[sync.state];
  syncBtn.setAttribute('aria-label', syncBtn.title);
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
    // Only real edits are worth a push; markSynced also notifies, and pushing in
    // response to a confirmation would just loop.
    if (progress.dirty) sync.schedule();
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
  sync.attach(pattern, progress);
}

function showPatterns(): void {
  void openPatternList({
    currentId: session?.pattern.id ?? null,
    onOpen: (id) => openPattern(id),
    onError: (message) => alert(message),
  });
}

function showPalette(): void {
  if (!session) return;
  openSheet('Цвета', paletteList(session.pattern, selected, selectColour));
}

document.getElementById('open-patterns')?.addEventListener('click', showPatterns);
document.getElementById('open-palette')?.addEventListener('click', showPalette);
document.getElementById('fit')?.addEventListener('click', () => {
  if (!session) return;
  session.renderer.viewport.fit();
  session.renderer.requestDraw();
});
function showSettings(): void {
  // Restoring a backup replaces the charts under our feet, so start over from the list.
  openSettings(sync, () => void openInitial());
}

syncBtn.addEventListener('click', showSettings);
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
sync.onChange(updateSyncBadge);
updateSyncBadge();

// Anything unsaved must reach IndexedDB before the tab is frozen or killed, and
// the moment the app is put away is the best chance to get it off the device too.
for (const event of ['visibilitychange', 'pagehide'] as const) {
  window.addEventListener(event, () => {
    if (event === 'visibilitychange' && document.visibilityState === 'visible') return;
    void session?.progress.flush().then(() => sync.run());
  });
}

/** Picks up where the app was left, or explains why it cannot. */
async function openInitial(): Promise<void> {
  let patterns: PatternSummary[] = [];
  try {
    patterns = await listPatterns();
  } catch (err) {
    console.error(err);
  }

  const wanted = localStorage.getItem(LAST_PATTERN);
  const id = patterns.find((p) => p.id === wanted)?.id ?? patterns[0]?.id;

  if (!id) {
    showSplash(
      'Схем пока нет. Откройте файл .xsd — он разберётся прямо здесь, — ' +
        'или настройте синхронизацию, если схема уже лежит на сервере.',
      splashButtons(),
    );
    return;
  }

  try {
    await openPattern(id);
  } catch (err) {
    console.error(err);
    showSplash(
      `Не удалось открыть схему: ${err instanceof Error ? err.message : err}`,
      splashButtons(),
    );
  }
}

/** The header is hidden behind the splash, so its two escape hatches go here. */
function splashButtons(): Node {
  const box = document.createDocumentFragment();
  const open = document.createElement('button');
  open.textContent = 'Открыть схему';
  open.onclick = showPatterns;
  const settings = document.createElement('button');
  settings.textContent = 'Настройки';
  settings.onclick = showSettings;
  box.append(open, settings);
  return box;
}

void (async () => {
  void requestPersistence();
  keepScreenAwake();
  await openInitial();
})();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
