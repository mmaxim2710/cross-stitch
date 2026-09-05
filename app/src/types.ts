export const EMPTY = 0xff; // cell value meaning "no stitch"

export type PaletteEntry = {
  index: number;
  color: string;
  number: string;
  name: string;
  dmc: string | null;
  count: number;
};

export type Pattern = {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  stitchesPerInch: [number, number];
  stitchCount: number;
  palette: PaletteEntry[];
  /** width * height bytes, one palette index per cell, EMPTY where there is no stitch. */
  cells: Uint8Array;
};

export type PatternSummary = {
  id: string;
  name: string;
  width: number;
  height: number;
  stitchCount: number;
};

export type StoredProgress = {
  patternId: string;
  /** Version last confirmed by the server; 0 until the sync stage exists. */
  version: number;
  bits: Uint8Array;
  /** Last state confirmed by the server, kept for the three-way merge. */
  base: Uint8Array;
  dirty: boolean;
  updatedAt: number;
};
