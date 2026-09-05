import type { Viewport } from '../render/viewport';

export type Mode = 'view' | 'mark';

export type InteractionHandlers = {
  mode(): Mode;
  /** Cell tapped in view mode — picks that cell's colour. */
  tap(index: number): void;
  /** First cell of a marking gesture; direction is decided from it. */
  strokeStart(index: number): void;
  strokeMove(index: number): void;
  strokeEnd(): void;
  /** Pan or zoom happened; the view needs redrawing. */
  changed(): void;
};

const TAP_SLOP = 10; // px of movement still counted as a tap
const TAP_TIME = 400;
const DOUBLE_TAP_TIME = 300;

type Point = { x: number; y: number };

/**
 * Panning and swipe-marking are the same gesture, so the two modes are kept apart
 * deliberately: dragging pans in view mode and paints in mark mode. Pinch-zoom
 * works in both.
 */
export function attachInteraction(
  canvas: HTMLCanvasElement,
  vp: Viewport,
  h: InteractionHandlers,
): void {
  const pointers = new Map<number, Point>();
  let startedAt = 0;
  let start: Point = { x: 0, y: 0 };
  let moved = 0;
  let painting = false;
  let lastCell: Point | null = null;
  let pinchDistance = 0;
  let pinchCentre: Point = { x: 0, y: 0 };
  let lastTapAt = 0;

  const local = (e: PointerEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const paintAt = (p: Point): void => {
    const cell = vp.cellAt(p.x, p.y);
    if (!cell) return;
    if (!painting) {
      painting = true;
      h.strokeStart(cell.index);
    } else {
      h.strokeMove(cell.index);
    }
    lastCell = { x: cell.cx, y: cell.cy };
  };

  /** Walks every cell between two touch samples so a fast swipe skips none. */
  const paintLine = (from: Point, to: Point): void => {
    const a = { x: (from.x - vp.x) / vp.scale, y: (from.y - vp.y) / vp.scale };
    const b = { x: (to.x - vp.x) / vp.scale, y: (to.y - vp.y) / vp.scale };
    const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const cx = Math.floor(a.x + (b.x - a.x) * t);
      const cy = Math.floor(a.y + (b.y - a.y) * t);
      if (lastCell && lastCell.x === cx && lastCell.y === cy) continue;
      if (cx < 0 || cy < 0 || cx >= vp.cols || cy >= vp.rows) continue;
      const index = cy * vp.cols + cx;
      if (!painting) {
        painting = true;
        h.strokeStart(index);
      } else {
        h.strokeMove(index);
      }
      lastCell = { x: cx, y: cy };
    }
  };

  const endStroke = (): void => {
    if (!painting) return;
    painting = false;
    lastCell = null;
    h.strokeEnd();
  };

  const beginPinch = (): void => {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    pinchCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 2) {
      endStroke(); // a second finger means zoom, not marking
      beginPinch();
      return;
    }
    if (pointers.size > 2) return;

    startedAt = performance.now();
    start = p;
    moved = 0;
    // Marking waits for the first move or for the release: a finger that turns out
    // to be half of a pinch must not leave a stray cell behind.
  });

  canvas.addEventListener('pointermove', (e) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    const p = local(e);
    pointers.set(e.pointerId, p);

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDistance > 0) {
        vp.panBy(centre.x - pinchCentre.x, centre.y - pinchCentre.y);
        vp.zoomAt(distance / pinchDistance, centre.x, centre.y);
      }
      pinchDistance = distance;
      pinchCentre = centre;
      h.changed();
      return;
    }

    moved = Math.max(moved, Math.hypot(p.x - start.x, p.y - start.y));
    if (h.mode() === 'mark') {
      paintLine(previous, p);
    } else {
      vp.panBy(p.x - previous.x, p.y - previous.y);
      h.changed();
    }
  });

  const release = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 1) {
      // Dropping back to one finger: restart tracking so the view does not jump.
      const [only] = [...pointers.values()];
      start = only;
      moved = TAP_SLOP + 1; // whatever follows is a drag, never a tap
      pinchDistance = 0;
      return;
    }
    if (pointers.size > 0) return;

    const still = moved <= TAP_SLOP;
    if (h.mode() === 'mark') {
      if (still && !painting) paintAt(start); // a plain tap marks one cell
      endStroke();
      return;
    }

    endStroke();
    if (!still || performance.now() - startedAt > TAP_TIME) return;

    const now = performance.now();
    if (now - lastTapAt < DOUBLE_TAP_TIME) {
      lastTapAt = 0;
      vp.fit();
      h.changed();
      return;
    }
    lastTapAt = now;
    const cell = vp.cellAt(start.x, start.y);
    if (cell) h.tap(cell.index);
  };

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Desktop convenience; the phone never sees these.
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      vp.zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
      h.changed();
    },
    { passive: false },
  );
}
