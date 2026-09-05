import { symbolFor } from '../render/symbols';
import type { Pattern, PaletteEntry } from '../types';
import { contrastText } from '../util';

type Select = (index: number | null) => void;

function swatchStyle(el: HTMLElement, entry: PaletteEntry): void {
  el.style.background = entry.color;
  el.style.color = contrastText(entry.color);
  el.textContent = symbolFor(entry.index);
}

/** Horizontal strip of colour chips above the mode switch. */
export function renderChips(
  host: HTMLElement,
  pattern: Pattern,
  selected: number | null,
  onSelect: Select,
): void {
  host.replaceChildren(
    ...pattern.palette.map((entry) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (entry.index === selected ? ' selected' : '');
      chip.title = `${entry.name} — ${entry.count} кл.`;
      swatchStyle(chip, entry);
      // Tapping the selected colour again clears the highlight.
      chip.onclick = () => onSelect(entry.index === selected ? null : entry.index);
      return chip;
    }),
  );
  host.querySelector('.chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/** Full colour list for the bottom sheet. */
export function paletteList(pattern: Pattern, selected: number | null, onSelect: Select): Node {
  const list = document.createElement('div');
  for (const entry of pattern.palette) {
    const row = document.createElement('button');
    row.className = 'row' + (entry.index === selected ? ' selected' : '');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatchStyle(swatch, entry);

    const grow = document.createElement('span');
    grow.className = 'grow';
    const name = document.createElement('b');
    name.textContent = entry.dmc ? `DMC ${entry.dmc}` : entry.name;
    const meta = document.createElement('span');
    meta.className = 'count';
    meta.textContent = `№ ${entry.number} · ${entry.color}`;
    grow.append(name, meta);

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(entry.count);

    row.append(swatch, grow, count);
    row.onclick = () => onSelect(entry.index === selected ? null : entry.index);
    list.append(row);
  }
  return list;
}
