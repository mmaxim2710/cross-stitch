import { db } from './db';
import type { StoredProgress } from '../types';
import { debounce } from '../util';

const UNDO_LIMIT = 200;

/** One gesture, not one cell — a swipe undoes as a single step. */
type Op = { indices: Int32Array; value: boolean };

const POPCOUNT = new Uint8Array(256);
for (let i = 1; i < 256; i++) POPCOUNT[i] = POPCOUNT[i >> 1] + (i & 1);

export class Progress {
  readonly patternId: string;
  readonly size: number;
  bits: Uint8Array;
  base: Uint8Array;
  version: number;
  dirty: boolean;
  done = 0;

  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  private stroke: number[] | null = null;
  private strokeValue = true;
  private listeners = new Set<() => void>();
  private save = debounce(400, () => void this.persist());

  constructor(patternId: string, size: number, stored?: StoredProgress) {
    this.patternId = patternId;
    this.size = size;
    const bytes = (size + 7) >> 3;
    this.bits = stored?.bits?.length === bytes ? new Uint8Array(stored.bits) : new Uint8Array(bytes);
    this.base = stored?.base?.length === bytes ? new Uint8Array(stored.base) : new Uint8Array(bytes);
    this.version = stored?.version ?? 0;
    this.dirty = stored?.dirty ?? false;
    for (const b of this.bits) this.done += POPCOUNT[b];
  }

  static async load(patternId: string, size: number): Promise<Progress> {
    return new Progress(patternId, size, await db.getProgress(patternId));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(i: number): boolean {
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Direction is fixed by the first cell of a gesture so a swipe cannot flip-flop. */
  beginStroke(value: boolean): void {
    this.stroke = [];
    this.strokeValue = value;
  }

  paint(i: number): void {
    if (this.stroke === null || i < 0 || i >= this.size) return;
    if (this.write(i, this.strokeValue)) this.stroke.push(i);
  }

  endStroke(): void {
    const touched = this.stroke;
    this.stroke = null;
    if (!touched || touched.length === 0) return;
    this.undoStack.push({ indices: Int32Array.from(touched), value: this.strokeValue });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.changed();
  }

  undo(): void {
    const op = this.undoStack.pop();
    if (!op) return;
    for (const i of op.indices) this.write(i, !op.value);
    this.redoStack.push(op);
    this.changed();
  }

  redo(): void {
    const op = this.redoStack.pop();
    if (!op) return;
    for (const i of op.indices) this.write(i, op.value);
    this.undoStack.push(op);
    this.changed();
  }

  /** Replaces the whole mask (import, or a merge from the server) and clears history. */
  replace(bits: Uint8Array): void {
    this.bits = new Uint8Array(bits);
    this.done = 0;
    for (const b of this.bits) this.done += POPCOUNT[b];
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.changed();
  }

  snapshot(): StoredProgress {
    return {
      patternId: this.patternId,
      version: this.version,
      bits: this.bits,
      base: this.base,
      dirty: this.dirty,
      updatedAt: Date.now(),
    };
  }

  /** Writes through immediately; used when the page is being hidden or unloaded. */
  flush(): Promise<void> {
    this.save.cancel();
    return this.persist();
  }

  private write(i: number, value: boolean): boolean {
    const byte = i >> 3;
    const mask = 1 << (i & 7);
    const was = (this.bits[byte] & mask) !== 0;
    if (was === value) return false;
    if (value) {
      this.bits[byte] |= mask;
      this.done++;
    } else {
      this.bits[byte] &= ~mask;
      this.done--;
    }
    return true;
  }

  private changed(): void {
    this.dirty = true;
    for (const fn of this.listeners) fn();
    this.save();
  }

  private async persist(): Promise<void> {
    try {
      await db.putProgress(this.snapshot());
    } catch (err) {
      console.error('progress write failed', err);
    }
  }
}
