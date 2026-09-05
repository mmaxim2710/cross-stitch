export type Theme = {
  dark: boolean;
  /** Unstitched canvas. */
  fabric: [number, number, number];
  /** What unselected colours are mixed towards; mid-grey so that both dark and
      light threads stay visible once a colour is picked. */
  mute: [number, number, number];
  /** What a finished cell is mixed towards. */
  doneTint: [number, number, number];
  grid: string;
  gridMajor: string;
  axis: string;
  rulerBg: string;
  rulerText: string;
  check: string;
};

const LIGHT: Theme = {
  dark: false,
  fabric: [0xf4, 0xf1, 0xea],
  mute: [0xd8, 0xd4, 0xcb],
  doneTint: [0x1a, 0x1c, 0x20],
  grid: 'rgba(0,0,0,0.16)',
  gridMajor: 'rgba(0,0,0,0.42)',
  axis: 'rgba(190,40,40,0.75)',
  rulerBg: 'rgba(244,241,234,0.94)',
  rulerText: '#4a4a4a',
  check: 'rgba(255,255,255,0.92)',
};

const DARK: Theme = {
  dark: true,
  fabric: [0x22, 0x24, 0x28],
  mute: [0x40, 0x44, 0x4a],
  doneTint: [0x0a, 0x0b, 0x0d],
  grid: 'rgba(255,255,255,0.16)',
  gridMajor: 'rgba(255,255,255,0.4)',
  axis: 'rgba(255,110,110,0.75)',
  rulerBg: 'rgba(24,26,30,0.94)',
  rulerText: '#a8adb6',
  check: 'rgba(255,255,255,0.9)',
};

const query = window.matchMedia('(prefers-color-scheme: dark)');

export function currentTheme(): Theme {
  return query.matches ? DARK : LIGHT;
}

export function onThemeChange(fn: () => void): void {
  query.addEventListener('change', fn);
}
