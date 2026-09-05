import { clamp } from '../util';

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 80;

export type Inset = { left: number; top: number; right: number; bottom: number };

/** Maps between cell coordinates and CSS pixels. Pan is a translation, zoom a scale. */
export class Viewport {
  /** CSS pixels per cell. */
  scale = 1;
  /** Screen position of the pattern's top-left corner, in CSS pixels. */
  x = 0;
  y = 0;
  viewW = 1;
  viewH = 1;

  constructor(
    readonly cols: number,
    readonly rows: number,
    private inset: Inset,
  ) {}

  resize(viewW: number, viewH: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
  }

  get contentW(): number {
    return Math.max(1, this.viewW - this.inset.left - this.inset.right);
  }

  get contentH(): number {
    return Math.max(1, this.viewH - this.inset.top - this.inset.bottom);
  }

  fitScale(): number {
    return Math.min(this.contentW / this.cols, this.contentH / this.rows);
  }

  fit(): void {
    this.scale = clamp(this.fitScale(), MIN_SCALE, MAX_SCALE);
    this.x = this.inset.left + (this.contentW - this.cols * this.scale) / 2;
    this.y = this.inset.top + (this.contentH - this.rows * this.scale) / 2;
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clampPosition();
  }

  /** Zooms around a screen point so the cell under the fingers stays put. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const next = clamp(this.scale * factor, Math.min(MIN_SCALE, this.fitScale()), MAX_SCALE);
    const k = next / this.scale;
    this.x = sx - (sx - this.x) * k;
    this.y = sy - (sy - this.y) * k;
    this.scale = next;
    this.clampPosition();
  }

  /** Cell under a screen point, or null outside the pattern. */
  cellAt(sx: number, sy: number): { cx: number; cy: number; index: number } | null {
    const cx = Math.floor((sx - this.x) / this.scale);
    const cy = Math.floor((sy - this.y) / this.scale);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return null;
    return { cx, cy, index: cy * this.cols + cx };
  }

  /** Range of cells covered by the content area, clipped to the pattern. */
  visibleCells(): { x0: number; y0: number; x1: number; y1: number } {
    const x0 = Math.max(0, Math.floor((this.inset.left - this.x) / this.scale));
    const y0 = Math.max(0, Math.floor((this.inset.top - this.y) / this.scale));
    const x1 = Math.min(this.cols, Math.ceil((this.viewW - this.x) / this.scale));
    const y1 = Math.min(this.rows, Math.ceil((this.viewH - this.y) / this.scale));
    return { x0, y0, x1, y1 };
  }

  /** Keeps at least a corner of the pattern on screen; centres it when it fits. */
  private clampPosition(): void {
    const w = this.cols * this.scale;
    const h = this.rows * this.scale;
    const { left, top, right, bottom } = this.inset;
    this.x =
      w <= this.contentW
        ? left + (this.contentW - w) / 2
        : clamp(this.x, this.viewW - right - w, left);
    this.y =
      h <= this.contentH
        ? top + (this.contentH - h) / 2
        : clamp(this.y, this.viewH - bottom - h, top);
  }
}
