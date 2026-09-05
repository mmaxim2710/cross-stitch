/**
 * The .xsd we have carries no symbol codes (all zero), so glyphs are generated on
 * our side, deterministically by palette index — the same colour always gets the
 * same symbol.
 */
const GLYPHS = [
  '●', '■', '▲', '▼', '◆', '★', '○', '□',
  '△', '▽', '◇', '☆', '◐', '◑', '◧', '◨',
  '◈', '◉', '◍', '◎', '✚', '✖', '✦', '✧',
  '♠', '♣', '♥', '♦', '⬗', '⬖', '⬒', '⬓',
];

export function symbolFor(paletteIndex: number): string {
  return GLYPHS[paletteIndex % GLYPHS.length];
}
