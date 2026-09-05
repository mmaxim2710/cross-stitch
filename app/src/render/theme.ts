export type Theme = {
  dark: boolean;
  /** Unstitched canvas. */
  fabric: [number, number, number];
  /** What unselected colours are mixed towards; mid-grey so that both dark and
      light threads stay visible once a colour is picked. */
  mute: [number, number, number];
  /** Flat grey a finished cell is painted with: what is left to stitch has to be
      readable at a glance, and a tinted thread colour still reads as that colour. */
  done: [number, number, number];
  grid: string;
  gridMajor: string;
  axis: string;
  rulerBg: string;
  rulerText: string;
  check: string;
  /** Outline around the cells of the picked colour. */
  outline: string;
  /** Outline and wash over cells waiting for the ✓ / ✗ confirmation. */
  pick: string;
  pickFill: string;
};

const LIGHT: Theme = {
  dark: false,
  fabric: [0xf4, 0xf1, 0xea],
  mute: [0xd8, 0xd4, 0xcb],
  done: [0xa6, 0xa3, 0x9b],
  grid: 'rgba(0,0,0,0.16)',
  gridMajor: 'rgba(0,0,0,0.42)',
  axis: 'rgba(190,40,40,0.75)',
  rulerBg: 'rgba(244,241,234,0.94)',
  rulerText: '#4a4a4a',
  check: 'rgba(0,0,0,0.5)',
  outline: 'rgba(20,22,26,0.85)',
  pick: '#1560c4',
  pickFill: 'rgba(21,96,196,0.3)',
};

const DARK: Theme = {
  dark: true,
  fabric: [0x22, 0x24, 0x28],
  mute: [0x40, 0x44, 0x4a],
  done: [0x2e, 0x31, 0x36],
  grid: 'rgba(255,255,255,0.16)',
  gridMajor: 'rgba(255,255,255,0.4)',
  axis: 'rgba(255,110,110,0.75)',
  rulerBg: 'rgba(24,26,30,0.94)',
  rulerText: '#a8adb6',
  check: 'rgba(255,255,255,0.5)',
  outline: 'rgba(240,243,248,0.85)',
  pick: '#6cb4ff',
  pickFill: 'rgba(108,180,255,0.28)',
};

const query = window.matchMedia('(prefers-color-scheme: dark)');

export function currentTheme(): Theme {
  return query.matches ? DARK : LIGHT;
}

export function onThemeChange(fn: () => void): void {
  query.addEventListener('change', fn);
}
