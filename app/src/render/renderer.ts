import type { Pattern } from '../types';
import { EMPTY } from '../types';
import { parseHexColor } from '../util';
import type { Progress } from '../state/progress';
import type { Selection } from '../state/selection';
import { symbolFor } from './symbols';
import type { Theme } from './theme';
import { Viewport } from './viewport';

export const RULER = 22;
/** Below this many pixels per cell, grid lines are noise rather than help. */
const GRID_MIN_SCALE = 6;
/** Symbols and check marks only make sense once a cell is big enough to hold one. */
const SYMBOL_MIN_SCALE = 14;
/** Below this, outlines merge into a solid blot and hide the colours underneath. */
const OUTLINE_MIN_SCALE = 3;
const MUTE = 0.8; // how far unselected colours are pushed towards the muted grey

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function luminance([r, g, b]: RGB): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

type Member = (cx: number, cy: number) => boolean;

/** Adds the sides of one cell that face a non-member neighbour. */
function border(
  path: Path2D,
  cx: number,
  cy: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  member: Member,
): void {
  if (!member(cx, cy - 1)) {
    path.moveTo(left, top);
    path.lineTo(right, top);
  }
  if (!member(cx, cy + 1)) {
    path.moveTo(left, bottom);
    path.lineTo(right, bottom);
  }
  if (!member(cx - 1, cy)) {
    path.moveTo(left, top);
    path.lineTo(left, bottom);
  }
  if (!member(cx + 1, cy)) {
    path.moveTo(right, top);
    path.lineTo(right, bottom);
  }
}

/**
 * The whole pattern is one pixel per cell in an offscreen canvas, blown up with
 * `drawImage` and smoothing off. Pan and zoom are then a single blit; the small
 * canvas is rebuilt only when the colours themselves change.
 */
export class Renderer {
  readonly viewport: Viewport;
  selected: number | null = null;

  private ctx: CanvasRenderingContext2D;
  private cells: HTMLCanvasElement;
  private cellsCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private colors: RGB[];
  private stale = true;
  private frame = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private pattern: Pattern,
    private progress: Progress,
    private selection: Selection,
    private theme: Theme,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d недоступен');
    this.ctx = ctx;

    this.cells = document.createElement('canvas');
    this.cells.width = pattern.width;
    this.cells.height = pattern.height;
    const cellsCtx = this.cells.getContext('2d');
    if (!cellsCtx) throw new Error('canvas 2d недоступен');
    this.cellsCtx = cellsCtx;
    this.image = cellsCtx.createImageData(pattern.width, pattern.height);

    this.colors = pattern.palette.map((p) => parseHexColor(p.color));
    this.viewport = new Viewport(pattern.width, pattern.height, {
      left: RULER,
      top: RULER,
      right: 8,
      bottom: 8,
    });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.invalidate();
  }

  setSelected(index: number | null): void {
    this.selected = index;
    this.invalidate();
  }

  /** The colour cache no longer matches the state; rebuild before the next frame. */
  invalidate(): void {
    this.stale = true;
    this.requestDraw();
  }

  requestDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewport.resize(w, h);
  }

  /** Composited colour of a cell, matching what the pixel cache holds. */
  cellColor(value: number, done: boolean): RGB {
    const { fabric, mute, done: doneColor } = this.theme;
    if (value === EMPTY) return fabric;
    // Finished cells drop their thread colour entirely: the eye should be able to
    // find what is left without comparing shades of the same colour.
    if (done) return doneColor;
    const rgb = this.colors[value] ?? fabric;
    return this.selected !== null && value !== this.selected ? mix(rgb, mute, MUTE) : rgb;
  }

  private rebuild(): void {
    const { cells } = this.pattern;
    const data = this.image.data;
    for (let i = 0, o = 0; i < cells.length; i++, o += 4) {
      const value = cells[i];
      const [r, g, b] = this.cellColor(value, value !== EMPTY && this.progress.get(i));
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    this.cellsCtx.putImageData(this.image, 0, 0);
    this.stale = false;
  }

  draw(): void {
    if (this.stale) this.rebuild();
    const { ctx, viewport: vp, theme } = this;
    const [fr, fg, fb] = theme.fabric;

    ctx.save();
    ctx.fillStyle = theme.dark ? '#131417' : '#e6e2d9';
    ctx.fillRect(0, 0, vp.viewW, vp.viewH);

    const w = this.pattern.width * vp.scale;
    const h = this.pattern.height * vp.scale;
    ctx.fillStyle = 'rgb(' + fr + ',' + fg + ',' + fb + ')';
    ctx.fillRect(vp.x, vp.y, w, h);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.cells, vp.x, vp.y, w, h);

    this.drawGrid();
    this.drawOutlines();
    if (vp.scale >= SYMBOL_MIN_SCALE) this.drawSymbols();
    this.drawRulers();
    ctx.restore();
  }

  private drawGrid(): void {
    const { ctx, viewport: vp, theme } = this;
    if (vp.scale < GRID_MIN_SCALE) return;
    const { x0, y0, x1, y1 } = vp.visibleCells();
    const top = Math.max(vp.y, RULER);
    const bottom = Math.min(vp.y + this.pattern.height * vp.scale, vp.viewH);
    const left = Math.max(vp.x, RULER);
    const right = Math.min(vp.x + this.pattern.width * vp.scale, vp.viewW);

    const column = (cx: number) => {
      const p = Math.round(vp.x + cx * vp.scale) + 0.5;
      ctx.moveTo(p, top);
      ctx.lineTo(p, bottom);
    };
    const row = (cy: number) => {
      const p = Math.round(vp.y + cy * vp.scale) + 0.5;
      ctx.moveTo(left, p);
      ctx.lineTo(right, p);
    };

    if (vp.scale >= SYMBOL_MIN_SCALE) {
      ctx.beginPath();
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      for (let cx = x0; cx <= x1; cx++) if (cx % 10) column(cx);
      for (let cy = y0; cy <= y1; cy++) if (cy % 10) row(cy);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.strokeStyle = theme.gridMajor;
    ctx.lineWidth = 1;
    for (let cx = Math.ceil(x0 / 10) * 10; cx <= x1; cx += 10) column(cx);
    for (let cy = Math.ceil(y0 / 10) * 10; cy <= y1; cy += 10) row(cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 2;
    column(this.pattern.width / 2);
    row(this.pattern.height / 2);
    ctx.stroke();
  }

  /**
   * Borders around the cells of the picked colour and around the cells waiting
   * for a ✓ / ✗. Only the outer edge of a run is drawn — a segment is emitted
   * where the neighbour is not a member — so a solid area reads as one region
   * rather than as a grid.
   */
  private drawOutlines(): void {
    const { ctx, viewport: vp, theme, selection } = this;
    const showPick = selection.count > 0;
    const showColour = this.selected !== null;
    if (vp.scale < OUTLINE_MIN_SCALE || (!showPick && !showColour)) return;

    const { x0, y0, x1, y1 } = vp.visibleCells();
    const { cells, width, height } = this.pattern;
    const picked = this.selected;

    const inColour = (cx: number, cy: number): boolean =>
      cx >= 0 && cy >= 0 && cx < width && cy < height && cells[cy * width + cx] === picked;
    const inPick = (cx: number, cy: number): boolean =>
      cx >= 0 && cy >= 0 && cx < width && cy < height && selection.has(cy * width + cx);

    const colourEdge = new Path2D();
    const pickEdge = new Path2D();
    const pickArea = new Path2D();

    for (let cy = y0; cy < y1; cy++) {
      const top = Math.round(vp.y + cy * vp.scale);
      const bottom = Math.round(vp.y + (cy + 1) * vp.scale);
      for (let cx = x0; cx < x1; cx++) {
        const colour = showColour && inColour(cx, cy);
        const pick = showPick && inPick(cx, cy);
        if (!colour && !pick) continue;
        const left = Math.round(vp.x + cx * vp.scale);
        const right = Math.round(vp.x + (cx + 1) * vp.scale);
        if (colour) border(colourEdge, cx, cy, left, top, right, bottom, inColour);
        if (pick) {
          pickArea.rect(left, top, right - left, bottom - top);
          border(pickEdge, cx, cy, left, top, right, bottom, inPick);
        }
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(RULER, RULER, vp.viewW - RULER, vp.viewH - RULER);
    ctx.clip();
    if (showColour) {
      ctx.strokeStyle = theme.outline;
      ctx.lineWidth = Math.max(1.5, vp.scale * 0.09);
      ctx.stroke(colourEdge);
    }
    if (showPick) {
      ctx.fillStyle = theme.pickFill;
      ctx.fill(pickArea);
      ctx.strokeStyle = theme.pick;
      ctx.lineWidth = Math.max(2, vp.scale * 0.14);
      ctx.stroke(pickEdge);
    }
    ctx.restore();
  }

  private drawSymbols(): void {
    const { ctx, viewport: vp } = this;
    const { x0, y0, x1, y1 } = vp.visibleCells();
    const { cells, width } = this.pattern;

    ctx.save();
    ctx.beginPath();
    ctx.rect(RULER, RULER, vp.viewW - RULER, vp.viewH - RULER);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.round(vp.scale * 0.62) + 'px system-ui, sans-serif';

    const check = vp.scale * 0.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, vp.scale * 0.1);

    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        const i = cy * width + cx;
        const value = cells[i];
        if (value === EMPTY) continue;
        const sx = vp.x + (cx + 0.5) * vp.scale;
        const sy = vp.y + (cy + 0.5) * vp.scale;

        if (this.progress.get(i)) {
          ctx.strokeStyle = this.theme.check;
          ctx.beginPath();
          ctx.moveTo(sx - check, sy);
          ctx.lineTo(sx - check * 0.25, sy + check * 0.75);
          ctx.lineTo(sx + check, sy - check * 0.7);
          ctx.stroke();
          continue;
        }

        ctx.fillStyle = luminance(this.cellColor(value, false)) < 0.5
          ? 'rgba(255,255,255,0.85)'
          : 'rgba(0,0,0,0.68)';
        ctx.fillText(symbolFor(value), sx, sy);
      }
    }
    ctx.restore();
  }

  private drawRulers(): void {
    const { ctx, viewport: vp, theme } = this;
    // Enough room for a label; the step grows as the pattern shrinks.
    const step = [1, 2, 5, 10, 20, 50, 100].find((s) => s * vp.scale >= 30) ?? 100;
    const { x0, y0, x1, y1 } = vp.visibleCells();

    ctx.fillStyle = theme.rulerBg;
    ctx.fillRect(0, 0, vp.viewW, RULER);
    ctx.fillRect(0, 0, RULER, vp.viewH);

    ctx.fillStyle = theme.rulerText;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let cx = Math.ceil(x0 / step) * step; cx < x1; cx += step) {
      const sx = vp.x + (cx + 0.5) * vp.scale;
      if (sx > RULER + 6) ctx.fillText(String(cx + 1), sx, RULER / 2);
    }
    for (let cy = Math.ceil(y0 / step) * step; cy < y1; cy += step) {
      const sy = vp.y + (cy + 0.5) * vp.scale;
      if (sy > RULER + 6) ctx.fillText(String(cy + 1), RULER / 2, sy);
    }
  }
}
