export type BoundaryStyle = 'classic' | 'sections';

const KEY = 'cross-stitch:boundary-style';

export function loadBoundaryStyle(): BoundaryStyle {
  return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'sections';
}

export function saveBoundaryStyle(style: BoundaryStyle): void {
  localStorage.setItem(KEY, style);
}
