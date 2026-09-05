import type { Pattern } from '../types';
import { EMPTY } from '../types';
import { parseHexColor } from '../util';

/**
 * One pixel per cell, drawn at natural size and left for CSS to scale up with
 * `image-rendering: pixelated` — at 154 × 154 the whole chart is smaller than an
 * icon, so there is nothing to downsample.
 */
export function thumbnailUrl(pattern: Pattern): string {
  const canvas = document.createElement('canvas');
  canvas.width = pattern.width;
  canvas.height = pattern.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const image = ctx.createImageData(pattern.width, pattern.height);
  const rgb = pattern.palette.map((entry) => parseHexColor(entry.color));

  for (let i = 0; i < pattern.cells.length; i++) {
    const value = pattern.cells[i];
    const colour = value === EMPTY ? undefined : rgb[value];
    const o = i * 4;
    if (!colour) continue; // transparent: the sheet's own background shows through
    image.data[o] = colour[0];
    image.data[o + 1] = colour[1];
    image.data[o + 2] = colour[2];
    image.data[o + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
